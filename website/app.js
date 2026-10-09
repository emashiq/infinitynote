/* global document, window, navigator, fetch, requestAnimationFrame */
// Adds the version and size to the download links and highlights the visitor's OS.
// Every link already points at releases/latest/download/<stable name>, so the page works without
// JavaScript. releases.json is written by .github/scripts/pages-releases.mjs when the site is
// deployed; if it is missing (local preview) the public GitHub API is asked instead. It names, for
// each download, the newest published release that carries it.
(function () {
  'use strict';

  var REPO = 'emashiq/infinitynote';

  // Same rules as .github/scripts/pages-releases.mjs (the stable names from release.yml).
  var MATCHERS = {
    windowsSetup: /^Infinity-Notes-Setup-x64\.exe$/,
    deb: /^infinity-notes_amd64\.deb$/,
    appImage: /^Infinity-Notes-x86_64\.AppImage$/,
  };

  function formatSize(bytes) {
    return bytes ? Math.round(bytes / 1048576) + ' MB' : '';
  }

  // Newest non-draft release that carries each kind of asset.
  function pickFromApi(releases) {
    var out = {};
    releases
      .filter(function (r) {
        return !r.draft;
      })
      .forEach(function (release) {
        var sums = release.assets.find(function (a) {
          return a.name === 'SHA256SUMS.txt';
        });
        release.assets.forEach(function (asset) {
          Object.keys(MATCHERS).forEach(function (key) {
            if (out[key] || !MATCHERS[key].test(asset.name)) return;
            out[key] = {
              name: asset.name,
              url: asset.browser_download_url,
              size: asset.size,
              tag: release.tag_name,
              checksums: sums ? sums.browser_download_url : null,
            };
          });
        });
      });
    return out;
  }

  function load() {
    return fetch('releases.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('no releases.json');
        return res.json();
      })
      .then(function (data) {
        return data.assets;
      })
      .catch(function () {
        return fetch('https://api.github.com/repos/' + REPO + '/releases?per_page=30')
          .then(function (res) {
            if (!res.ok) throw new Error('GitHub API ' + res.status);
            return res.json();
          })
          .then(pickFromApi);
      });
  }

  function apply(assets) {
    document.querySelectorAll('[data-asset]').forEach(function (link) {
      var key = link.getAttribute('data-asset');
      if (key === 'checksums') {
        var main = assets.windowsSetup || assets.deb;
        if (main && main.checksums) link.href = main.checksums;
        return;
      }
      var asset = assets[key];
      if (!asset) return;
      link.href = asset.url;
      var meta = link.querySelector('[data-meta]');
      if (meta) meta.textContent = [asset.tag, formatSize(asset.size)].filter(Boolean).join(' · ');
    });

    var line = document.getElementById('release-line');
    var win = assets.windowsSetup;
    var linux = assets.deb || assets.appImage;
    if (line && (win || linux)) {
      var text = 'Latest: ' + (win || linux).tag;
      if (win && linux && linux.tag !== win.tag) {
        text = 'Latest: ' + win.tag + ' (Windows) · ' + linux.tag + ' (Linux)';
      }
      line.textContent = text + '. Unsigned builds with SHA-256 checksums.';
    }
    return assets;
  }

  function detectOs() {
    var platform =
      (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var ua = navigator.userAgent || '';
    if (/win/i.test(platform) || /Windows/.test(ua)) return 'windows';
    if (/linux/i.test(platform) && !/Android/.test(ua)) return 'linux';
    return null;
  }

  // Marks the visitor's download card and points the hero button straight at its main download.
  function highlightOs() {
    var os = detectOs();
    var hero = document.getElementById('hero-download');
    if (!os || !hero) return;
    var card = document.getElementById('card-' + os);
    if (!card) return;
    card.classList.add('recommended');
    var main = card.querySelector('a.dl.main');
    if (main) hero.href = main.href;
    var label = hero.querySelector('span');
    if (label) label.textContent = os === 'windows' ? 'Download for Windows' : 'Download for Linux (.deb)';
  }

  // Docs page: mark the table-of-contents entry of the last section whose heading has scrolled
  // past the top third of the window.
  function trackToc() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
    var sections = links
      .map(function (a) {
        return document.getElementById(a.getAttribute('href').slice(1));
      })
      .filter(Boolean);
    if (!sections.length) return;
    var pending = false;
    function update() {
      pending = false;
      var current = sections[0];
      sections.forEach(function (section) {
        if (section.getBoundingClientRect().top < window.innerHeight / 3) current = section;
      });
      links.forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + current.id);
      });
    }
    window.addEventListener(
      'scroll',
      function () {
        if (!pending) {
          pending = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
  }

  trackToc();
  if (document.querySelector('[data-asset]')) {
    highlightOs();
    load()
      .then(apply)
      .then(highlightOs)
      .catch(function () {
        // Keep the static releases/latest/download links.
      });
  }
})();
