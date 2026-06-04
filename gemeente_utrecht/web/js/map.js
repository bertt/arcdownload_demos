'use strict';
var params = new URLSearchParams(location.search);
var FGB    = params.get('fgb') || '';
// FGB path may be relative (e.g. ../output/fgb/Layer/Layer.fgb) or absolute
var META   = FGB ? FGB.replace(/\.fgb$/i, '.meta.json') : '';
var STY    = FGB ? FGB.replace(/\.fgb$/i, '.json')      : '';
var layerName = FGB ? FGB.split('/').pop().replace(/\.fgb$/i, '') : '';
var fgbUrl = FGB ? new URL(FGB, location.href).href : '';

if (layerName) {
  document.title = layerName;
  document.getElementById('topbar-title').textContent = layerName;
} else {
  document.getElementById('topbar-title').textContent = 'No layer specified';
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
function geoLabel(t)  { return (t || '').replace('esriGeometry', ''); }
function typeLabel(t) { return (t || '').replace('esriFieldType', ''); }

function buildBasic(m, n) {
  var count = n != null ? n : (m.featureCount != null ? m.featureCount : '?');
  var desc  = m.description
    ? '<div class="kv" style="margin-top:6px;font-style:italic;color:#666">' + m.description + '</div>'
    : '';
  var link  = fgbUrl
    ? '<div class="kv" style="margin-top:6px">File: <a class="v" href="' + fgbUrl + '" download>' + FGB + '</a>' +
      '<button class="copy-btn" onclick="navigator.clipboard.writeText(\'' + fgbUrl + '\').then(function(){var b=this;b.textContent=\'✓\';setTimeout(function(){b.textContent=\'Copy URL\';},1500);}.bind(this))">Copy URL</button></div>'
    : '';
  return '<div class="kv">Features: <span class="v">' + count + '</span></div>' +
         '<div class="kv">Geometry type: <span class="v">' + geoLabel(m.geometryType) + '</span></div>' +
         desc + link;
}

function buildFields(fields) {
  if (!fields || !fields.length)
    return '<em style="font-size:11px;color:#aaa">No attributes</em>';
  var rows = fields.map(function(f) {
    return '<tr><td>' + (f.name || '') + '</td><td>' + typeLabel(f.type) +
           '</td><td>' + (f.alias || '') + '</td></tr>';
  }).join('');
  return '<table class="at"><tr><th>Name</th><th>Type</th><th>Alias</th></tr>' + rows + '</table>';
}

function buildStyle(s) {
  if (!s) return '<em style="font-size:11px;color:#aaa">No styling</em>';
  var html = '<div class="kv">Type: <span class="v">' + (s.type || '?') + '</span></div>';
  if (s.paint) {
    Object.keys(s.paint).forEach(function(k) {
      var v   = s.paint[k];
      var sw  = (k.indexOf('color') >= 0 && typeof v === 'string')
                  ? '<span class="sw" style="background:' + v + '"></span>' : '';
      var val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      html += '<div class="kv">' + k + ': ' + sw + '<span class="v">' + val + '</span></div>';
    });
  }
  return html;
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
  if (!FGB) {
    setStatus('\u26a0\ufe0f No layer specified. Use ?fgb=<path to .fgb file>');
    document.getElementById('i-basic').innerHTML = '<em style="font-size:11px;color:#aaa">No layer selected</em>';
    document.getElementById('i-fields').innerHTML = '';
    document.getElementById('i-style').innerHTML = '';
    return;
  }
  var meta = null, sty = null;
  try { meta = await fetch(META).then(function(r) { return r.json(); }); } catch(e) {}
  try { sty  = await fetch(STY).then(function(r)  { return r.json(); }); } catch(e) {}

  document.getElementById('i-basic').innerHTML  = meta ? buildBasic(meta, null)      : '<em style="font-size:11px;color:#aaa">No metadata</em>';
  document.getElementById('i-fields').innerHTML = buildFields(meta ? meta.fields : null);
  document.getElementById('i-style').innerHTML  = buildStyle(sty);

  setStatus('Loading features\u2026');

  var features = [];
  try {
    var resp = await fetch(FGB);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    for await (var feat of flatgeobuf.deserialize(resp.body)) {
      features.push(feat);
    }
  } catch(e) {
    setStatus('Error loading: ' + e.message);
    return;
  }

  var b = computeBbox(features);

  if (b === 'invalid') {
    setStatus('\u26a0\ufe0f ' + features.length + ' features loaded, but coordinates are not in WGS84. Re-download the layer to view the map.');
    if (meta) document.getElementById('i-basic').innerHTML = buildBasic(meta, features.length);
    return;
  }

  map.addSource('data', { type: 'geojson', data: { type: 'FeatureCollection', features: features } });

  var mainLayerType = 'circle';
  if (sty) {
    var layer = {};
    for (var k in sty) { if (Object.prototype.hasOwnProperty.call(sty, k)) layer[k] = sty[k]; }
    if (layer.type === 'fill' && layer.paint && layer.paint['fill-opacity'] === 0) {
      layer.paint = Object.assign({}, layer.paint);
      delete layer.paint['fill-opacity'];
    }
    layer.id     = 'layer-main';
    layer.source = 'data';
    mainLayerType = layer.type || 'circle';
    map.addLayer(layer);
    if (layer.type === 'fill' && layer.paint) {
      var outlineColor = layer.paint['fill-outline-color'] || '#000';
      map.addLayer({ id: 'layer-main-outline', type: 'line', source: 'data',
                     paint: { 'line-color': outlineColor, 'line-width': 2 } });
    }
  } else {
    map.addLayer({ id: 'layer-main', type: 'circle', source: 'data',
                   paint: { 'circle-color': '#0070ff', 'circle-radius': 6, 'circle-opacity': 0.8 } });
  }

  map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  var hlPaint = {};
  if (mainLayerType === 'fill') {
    hlPaint = { 'fill-color': '#ff6600', 'fill-opacity': 0.4 };
  } else if (mainLayerType === 'line') {
    hlPaint = { 'line-color': '#ff6600', 'line-width': 4, 'line-opacity': 1 };
  } else {
    hlPaint = { 'circle-color': '#ff6600', 'circle-radius': 7, 'circle-opacity': 1, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 };
  }
  map.addLayer({ id: 'layer-highlight', type: mainLayerType, source: 'selected', paint: hlPaint });
  if (mainLayerType === 'fill') {
    map.addLayer({ id: 'layer-highlight-outline', type: 'line', source: 'selected',
                   paint: { 'line-color': '#ff3300', 'line-width': 3, 'line-opacity': 1 } });
  }

  if (b) map.fitBounds(b, { padding: 40, maxZoom: 16 });

  setStatus(features.length + ' features loaded.');
  if (meta) document.getElementById('i-basic').innerHTML = buildBasic(meta, features.length);

  map.on('click', function(e) {
    var bbox = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
    var hits = map.queryRenderedFeatures(bbox, { layers: ['layer-main'] });
    if (hits.length > 0) {
      var feat = hits[0];
      var plainFeat = { type: 'Feature', geometry: feat.geometry, properties: feat.properties };
      map.getSource('selected').setData({ type: 'FeatureCollection', features: [plainFeat] });
      var props = feat.properties;
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
