'use strict';

var params   = new URLSearchParams(location.search);
var GEOJSON  = params.get('geojson') || '';
var fileName = GEOJSON ? GEOJSON.split('/').pop() : '';

if (fileName) {
  document.title = fileName;
  document.getElementById('topbar-title').textContent = fileName;
} else {
  document.getElementById('topbar-title').textContent = 'No file specified';
}

var map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      }
    },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }]
  },
  center: [4.5, 52.2],
  zoom: 7
});

function setStatus(m) { document.getElementById('status').textContent = m; }

/** Extract EPSG numeric code from a CRS name string, or null if WGS84/unknown. */
function parseEpsgCode(crs) {
  if (!crs || !crs.properties || !crs.properties.name) return null;
  var name = crs.properties.name;
  // Already WGS84
  if (/EPSG::4326|EPSG:4326|CRS:84|CRS84|urn:ogc:def:crs:OGC/i.test(name)) return null;
  // urn:ogc:def:crs:EPSG::28992 or urn:ogc:def:crs:EPSG:6.6:28992
  var m = name.match(/EPSG:{1,2}(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** Reproject all coordinates in a GeoJSON FeatureCollection from fromEpsg to WGS84 in-place. */
async function reprojectFeatures(features, epsgCode) {
  var defUrl = 'https://epsg.io/' + epsgCode + '.proj4';
  var defStr;
  try {
    var r = await fetch(defUrl);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    defStr = await r.text();
  } catch (e) {
    throw new Error('Could not fetch proj4 definition for EPSG:' + epsgCode + ' (' + e.message + ')');
  }

  proj4.defs('EPSG:' + epsgCode, defStr);
  var converter = proj4('EPSG:' + epsgCode, 'WGS84');

  function transformCoords(coords) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      var wgs = converter.forward([coords[0], coords[1]]);
      coords[0] = wgs[0];
      coords[1] = wgs[1];
    } else {
      coords.forEach(transformCoords);
    }
  }

  features.forEach(function(f) {
    if (f.geometry && f.geometry.coordinates) transformCoords(f.geometry.coordinates);
  });
}

function computeBbox(features) {
  var r = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(c) {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      if (c[0] < r[0]) r[0] = c[0]; if (c[1] < r[1]) r[1] = c[1];
      if (c[0] > r[2]) r[2] = c[0]; if (c[1] > r[3]) r[3] = c[1];
    } else c.forEach(visit);
  }
  features.forEach(function(f) { if (f.geometry) visit(f.geometry.coordinates); });
  if (!isFinite(r[0])) return null;
  if (r[0] < -180 || r[2] > 180 || r[1] < -90 || r[3] > 90) return 'invalid';
  return [[r[0], r[1]], [r[2], r[3]]];
}

map.on('load', async function() {
  if (!GEOJSON) {
    setStatus('\u26a0\ufe0f No GeoJSON file specified. Use ?geojson=<path>');
    document.getElementById('i-basic').innerHTML = '<em style="font-size:11px;color:#aaa">No file selected</em>';
    return;
  }

  setStatus('Loading\u2026');

  var fc;
  try {
    var resp = await fetch(GEOJSON);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    fc = await resp.json();
  } catch(e) {
    setStatus('Error loading: ' + e.message);
    document.getElementById('i-basic').innerHTML = '<em style="font-size:11px;color:#aaa">Failed to load</em>';
    return;
  }

  var features = fc.type === 'FeatureCollection' ? fc.features : (fc.type === 'Feature' ? [fc] : []);

  // Detect and reproject non-WGS84 CRS
  var epsgCode = parseEpsgCode(fc.crs);
  var crsLabel = epsgCode ? 'EPSG:' + epsgCode : 'WGS84';
  if (epsgCode) {
    setStatus('Reprojecting from EPSG:' + epsgCode + '\u2026');
    try {
      await reprojectFeatures(features, epsgCode);
    } catch(e) {
      setStatus('\u26a0\ufe0f ' + e.message);
      document.getElementById('i-basic').innerHTML = '<em style="font-size:11px;color:#aaa">Reprojection failed</em>';
      return;
    }
  }

  document.getElementById('i-basic').innerHTML =
    '<div class="kv">Features: <span class="v">' + features.length + '</span></div>' +
    '<div class="kv">CRS: <span class="v">' + crsLabel + '</span></div>' +
    '<div class="kv" style="margin-top:6px">File: <a class="v" href="' + GEOJSON + '" download>' + fileName + '</a></div>';

  var b = computeBbox(features);

  if (b === 'invalid') {
    setStatus('\u26a0\ufe0f ' + features.length + ' features loaded, but coordinates appear invalid (not WGS84).');
    return;
  }

  map.addSource('data', { type: 'geojson', data: fc });

  var geomType = '';
  for (var i = 0; i < features.length; i++) {
    if (features[i].geometry) { geomType = features[i].geometry.type || ''; break; }
  }

  var isPolygon = geomType.indexOf('Polygon') >= 0;
  var isLine    = geomType.indexOf('Line') >= 0;

  if (isPolygon) {
    map.addLayer({ id: 'layer-main', type: 'fill', source: 'data',
                   paint: { 'fill-color': '#0070ff', 'fill-opacity': 0.4, 'fill-outline-color': '#0040cc' } });
  } else if (isLine) {
    map.addLayer({ id: 'layer-main', type: 'line', source: 'data',
                   paint: { 'line-color': '#0070ff', 'line-width': 2 } });
  } else {
    map.addLayer({ id: 'layer-main', type: 'circle', source: 'data',
                   paint: { 'circle-color': '#0070ff', 'circle-radius': 6, 'circle-opacity': 0.8 } });
  }

  map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  var hlPaint = isPolygon
    ? { 'fill-color': '#ff6600', 'fill-opacity': 0.5, 'fill-outline-color': '#ff3300' }
    : isLine
      ? { 'line-color': '#ff6600', 'line-width': 4 }
      : { 'circle-color': '#ff6600', 'circle-radius': 8, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 };
  var hlType = isPolygon ? 'fill' : isLine ? 'line' : 'circle';
  map.addLayer({ id: 'layer-highlight', type: hlType, source: 'selected', paint: hlPaint });

  if (b) map.fitBounds(b, { padding: 40, maxZoom: 16 });

  setStatus(features.length + ' features loaded.');

  map.on('click', function(e) {
    var bbox = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
    var hits = map.queryRenderedFeatures(bbox, { layers: ['layer-main'] });
    if (hits.length > 0) {
      var feat = hits[0];
      var plainFeat = { type: 'Feature', geometry: feat.geometry, properties: feat.properties };
      map.getSource('selected').setData({ type: 'FeatureCollection', features: [plainFeat] });
      var props = feat.properties || {};
      var rows = Object.keys(props).map(function(k) {
        var v = props[k];
        return '<tr><td>' + k + '</td><td class="v">' + (v != null ? v : '') + '</td></tr>';
      }).join('');
      document.getElementById('i-selected').innerHTML =
        '<table class="at"><tr><th>Attribute</th><th>Value</th></tr>' + rows + '</table>';
      document.getElementById('sel-panel').style.display = '';
      document.getElementById('sel-panel').scrollIntoView({ behavior: 'smooth' });
    } else {
      map.getSource('selected').setData({ type: 'FeatureCollection', features: [] });
      document.getElementById('sel-panel').style.display = 'none';
    }
  });

  map.on('mousemove', function(e) {
    var bbox = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
    var hits = map.queryRenderedFeatures(bbox, { layers: ['layer-main'] });
    map.getCanvas().style.cursor = hits.length > 0 ? 'pointer' : '';
  });
});
