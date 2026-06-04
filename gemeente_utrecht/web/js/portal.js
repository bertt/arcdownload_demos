'use strict';

(function () {
  var params = new URLSearchParams(window.location.search);
  var filterType = params.get('type') || '';

  document.getElementById('page-title').textContent =
    filterType ? 'Portal Items \u2014 ' + filterType : 'Portal Items';
  document.title = document.getElementById('page-title').textContent;

  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Load PORTAL_HOME from the manifest so links point to the correct portal
  fetch('../output/layers.json')
    .then(function(r) { return r.json(); })
    .catch(function() { return {}; })
    .then(function(manifest) {
      var PORTAL_HOME = (manifest && manifest.portalHome) ? manifest.portalHome : '';

      return fetch('../output/portal_items.json')
        .then(function(r) { return r.json(); })
        .then(function(all) {
          var items = filterType
            ? all.filter(function(i) { return i.type === filterType; })
            : all;

          document.getElementById('status').textContent =
            items.length + ' item' + (items.length !== 1 ? 's' : '') +
            (filterType ? ' of type \u201c' + filterType + '\u201d' : '');

          // Returns a view link HTML string for the given item, or '—' if not supported.
          // Add a new case here to support additional portal types.
          function buildViewLink(item, dataPath) {
            switch (item.type) {
              case 'GeoJson':
                return '<a href="portal_geojson.html?geojson=' + encodeURIComponent(dataPath) + '">View</a>';
              default:
                return '&mdash;';
            }
          }

          var rows = items.map(function(item) {
            var titleHtml;
            if (item.url) {
              titleHtml = '<a href="' + esc(item.url) + '" target="_blank">' + esc(item.title) + '</a>';
            } else if (PORTAL_HOME) {
              var href = PORTAL_HOME + '/item.html?id=' + encodeURIComponent(item.id);
              titleHtml = '<a href="' + href + '" target="_blank">' + esc(item.title) + '</a>';
            } else {
              titleHtml = esc(item.title);
            }
            var tags = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');
            var safeType = (item.type || 'Unknown').replace(/[/ ]/g, '_');
            var dataFile = (item.name && item.name.length > 0) ? item.name : (item.id + '.json');
            if (item.type === 'Feature Service' && !dataFile.endsWith('.json')) {
              dataFile = dataFile + '.json';
            }
            // Data path relative to web/: ../output/portal/<type>/<file>
            var dataPath = '../output/portal/' + safeType + '/' + dataFile;
            var dataHtml = '<a href="' + esc(dataPath) + '" target="_blank">' + esc(dataFile) + '</a>';
            var viewHtml = buildViewLink(item, dataPath);
            return '<tr>' +
              '<td class="title">'  + titleHtml           + '</td>' +
              '<td class="owner">'  + esc(item.owner)     + '</td>' +
              '<td class="date">'   + fmtDate(item.modified) + '</td>' +
              '<td class="snippet">'+ esc(item.snippet)   + '</td>' +
              '<td class="tags">'   + esc(tags)            + '</td>' +
              '<td class="data">'   + dataHtml             + '</td>' +
              '<td class="view">'   + viewHtml             + '</td>' +
              '</tr>';
          });

          document.getElementById('tbody').innerHTML = rows.join('');
          document.getElementById('tbl').style.display = '';
        });
    })
    .catch(function(e) {
      document.getElementById('status').textContent = 'Error loading portal data: ' + e.message;
    });
})();
