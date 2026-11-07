

(function () {
  'use strict';

  
  
  
  var KEY_PLAYLISTS  = 'm3u_playlists';
  var KEY_ADD_NAME   = 'pref_add_name';
  var KEY_ADD_URL    = 'pref_add_url';
  var KEY_EDIT_NAME  = 'pref_edit_name';
  var KEY_EDIT_URL   = 'pref_edit_url';

  
  
  
  function getPlaylists() {
    try {
      var raw = getPreference(KEY_PLAYLISTS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function savePlaylists(arr) {
    setPreference(KEY_PLAYLISTS, JSON.stringify(arr));
  }

  
  
  
  
  
  function encodeStreamUrl(url) {
    return 'channel://' + encodeURIComponent(url);
  }

  function decodeStreamUrl(encoded) {
    return decodeURIComponent(encoded.replace('channel://', ''));
  }

  
  
  
  
  
  function extractAttr(str, attr) {
    var re = new RegExp(attr + '="([^"]*)"', 'i');
    var m  = str.match(re);
    return m ? m[1].trim() : null;
  }

  function parseM3U(text) {
    var channels = [];
    var current  = null;
    var lines    = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line === '#EXTM3U') continue;

      if (line.indexOf('#EXTINF:') === 0) {
        current = {};

        
        var lastComma = line.lastIndexOf(',');
        current.name = lastComma >= 0
          ? line.substring(lastComma + 1).trim()
          : 'Sin nombre';
        if (!current.name) current.name = 'Sin nombre';

        
        var attrStr  = lastComma >= 0 ? line.substring(0, lastComma) : line;
        var tvgName  = extractAttr(attrStr, 'tvg-name');
        if (tvgName) current.name = tvgName;

        current.logo  = extractAttr(attrStr, 'tvg-logo') || null;
        current.group = extractAttr(attrStr, 'group-title') || 'General';
        current.id    = extractAttr(attrStr, 'tvg-id') || '';

      } else if (line.charAt(0) === '#') {
        

      } else if (current) {
        
        
        var pipePos   = line.indexOf('|');
        var streamUrl = pipePos >= 0 ? line.substring(0, pipePos) : line;
        var headers   = {};

        if (pipePos >= 0) {
          var parts = line.substring(pipePos + 1).split('&');
          for (var j = 0; j < parts.length; j++) {
            var eqPos = parts[j].indexOf('=');
            if (eqPos > 0) {
              headers[parts[j].substring(0, eqPos).trim()] =
                parts[j].substring(eqPos + 1).trim();
            }
          }
        }

        current.streamUrl = streamUrl;
        current.headers   = headers;
        channels.push(current);
        current = null;
      }
    }

    return channels;
  }

  
  
  
  async function fetchM3U(url) {
    try {
      var res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 11; SM-G991B) '
            + 'AppleWebKit/537.36 (KHTML, like Gecko) '
            + 'Chrome/90.0.4430.210 Mobile Safari/537.36'
        }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return parseM3U(await res.text());
    } catch (e) {
      return [];
    }
  }

  
  
  
  async function getHome(cb) {
    var playlists = getPlaylists();

    if (playlists.length === 0) {
      cb({
        success: true,
        data: {
          sections: [{
            name:  'ListaStream',
            items: [
              new MultimediaItem({
                name:     'Sin listas configuradas — Abre ⚙️ Ajustes del plugin para añadir tu primera lista M3U',
                url:      'listastream://empty',
                type:     'LiveTV',
                posterUrl: null
              })
            ]
          }]
        }
      });
      return;
    }

    
    var fetched = await Promise.all(
      playlists.map(async function (pl, idx) {
        var channels = await fetchM3U(pl.url);
        return { idx: idx, pl: pl, channels: channels };
      })
    );

    var sections = [];

    fetched.forEach(function (r) {
      if (!r.channels || r.channels.length === 0) {
        sections.push({
          name:  '⚠️ ' + r.pl.name + ' — Sin canales o error al cargar',
          items: []
        });
        return;
      }

      
      var groups    = {};
      var groupOrder = [];
      r.channels.forEach(function (ch) {
        var g = ch.group || 'General';
        if (!groups[g]) {
          groups[g] = [];
          groupOrder.push(g);
        }
        groups[g].push(ch);
      });

      groupOrder.forEach(function (gk) {
        
        var sectionName = groupOrder.length === 1
          ? '📺 ' + r.pl.name
          : r.pl.name + ' · ' + gk;

        sections.push({
          name:  sectionName,
          items: groups[gk].map(function (ch) {
            return new MultimediaItem({
              name:      ch.name,
              url:       encodeStreamUrl(ch.streamUrl),
              type:      'LiveTV',
              posterUrl: ch.logo || null
            });
          })
        });
      });
    });

    cb({ success: true, data: { sections: sections } });
  }

  
  
  
  async function search(query, page, cb) {
    var playlists = getPlaylists();

    if (!playlists.length) {
      cb({ success: true, data: { items: [], hasNextPage: false } });
      return;
    }

    var q = (query || '').toLowerCase().trim();
    if (!q) {
      cb({ success: true, data: { items: [], hasNextPage: false } });
      return;
    }

    var allFetched = await Promise.all(
      playlists.map(function (pl) { return fetchM3U(pl.url); })
    );

    var matched = [];
    allFetched.forEach(function (channels) {
      channels.forEach(function (ch) {
        if (ch.name.toLowerCase().indexOf(q) !== -1 ||
            ch.group.toLowerCase().indexOf(q) !== -1) {
          matched.push(ch);
        }
      });
    });

    cb({
      success: true,
      data: {
        items: matched.map(function (ch) {
          return new MultimediaItem({
            name:      ch.name,
            url:       encodeStreamUrl(ch.streamUrl),
            type:      'LiveTV',
            posterUrl: ch.logo || null
          });
        }),
        hasNextPage: false
      }
    });
  }

  
  
  
  async function load(url, cb) {
    if (url === 'listastream://empty') {
      cb({
        success: false,
        message: 'Añade una lista M3U desde los Ajustes del plugin (⚙️).'
      });
      return;
    }

    cb({
      success: true,
      data: new MultimediaItem({
        name:  'En vivo',
        url:   url,
        type:  'LiveTV',
        episodes: [
          new Episode({ name: '▶ Reproducir', url: url })
        ]
      })
    });
  }

  
  
  
  async function loadStreams(url, cb) {
    var streamUrl = decodeStreamUrl(url);

    cb({
      success: true,
      data: [
        new StreamResult({
          url:     streamUrl,
          quality: 'Auto',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 11) '
              + 'AppleWebKit/537.36 Mobile Safari/537.36'
          }
        })
      ]
    });
  }

  
  
  
  
  
  function getSettings(cb) {
    var playlists = getPlaylists();

    var prefs = [
      {
        key:   'cat_add',
        type:  'PreferenceCategory',
        title: 'Añadir lista M3U'
      },
      {
        key:          KEY_ADD_NAME,
        type:         'EditText',
        title:        'Nombre de la lista',
        summary:      'Nombre para identificar la lista',
        hint:         'Mi Lista IPTV',
        defaultValue: getPreference(KEY_ADD_NAME) || ''
      },
      {
        key:          KEY_ADD_URL,
        type:         'EditText',
        title:        'Enlace M3U',
        summary:      'URL directa del archivo .m3u o .m3u8',
        hint:         'https://mi-proveedor.com/lista.m3u',
        defaultValue: getPreference(KEY_ADD_URL) || ''
      },
      {
        key:     'action_add_playlist',
        type:    'Button',
        title:   'Añadir lista',
        summary: 'Guarda la lista con el nombre y enlace indicados',
        action:  'addPlaylist'
      }
    ];

    
    if (playlists.length > 0) {
      prefs.push({
        key:   'cat_saved',
        type:  'PreferenceCategory',
        title: 'Mis listas guardadas (' + playlists.length + ')'
      });

      playlists.forEach(function (pl, idx) {
        prefs.push({
          key:          'playlist_item_' + idx,
          type:         'PlaylistEntry',
          title:        pl.name,
          summary:      pl.url,
          editAction:   'editPlaylist',
          deleteAction: 'deletePlaylist',
          params:       { index: idx, name: pl.name, url: pl.url }
        });
      });
    } else {
      prefs.push({
        key:   'cat_saved',
        type:  'PreferenceCategory',
        title: 'Mis listas guardadas'
      });
      prefs.push({
        key:     'no_lists_info',
        type:    'Info',
        title:   'No hay listas guardadas',
        summary: 'Añade tu primera lista M3U usando el formulario de arriba.'
      });
    }

    cb({ success: true, data: prefs });
  }

  
  
  
  function onPreferenceAction(action, params, cb) {
    var playlists = getPlaylists();
    var name, url, idx;

    
    if (action === 'addPlaylist') {
      name = (getPreference(KEY_ADD_NAME) || '').trim();
      url  = (getPreference(KEY_ADD_URL)  || '').trim();

      if (!name || !url) {
        if (cb) cb({ success: false, message: 'El nombre y el enlace son obligatorios.' });
        return;
      }
      if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
        if (cb) cb({ success: false, message: 'El enlace debe comenzar con http:// o https://' });
        return;
      }

      playlists.push({ name: name, url: url, addedAt: Date.now() });
      savePlaylists(playlists);

      
      setPreference(KEY_ADD_NAME, '');
      setPreference(KEY_ADD_URL,  '');

      if (cb) cb({
        success:            true,
        refreshPreferences: true,
        message:            '✅ Lista "' + name + '" añadida correctamente.'
      });
      return;
    }

    
    if (action === 'editPlaylist') {
      idx  = parseInt((params && params.index !== undefined) ? params.index : -1, 10);
      name = (getPreference(KEY_EDIT_NAME) || '').trim();
      url  = (getPreference(KEY_EDIT_URL)  || '').trim();

      if (idx >= 0 && idx < playlists.length) {
        if (name) playlists[idx].name = name;
        if (url)  playlists[idx].url  = url;
        savePlaylists(playlists);
        setPreference(KEY_EDIT_NAME, '');
        setPreference(KEY_EDIT_URL,  '');
        if (cb) cb({
          success:            true,
          refreshPreferences: true,
          message:            '✅ Lista "' + playlists[idx].name + '" actualizada.'
        });
      } else {
        if (cb) cb({ success: false, message: 'No se encontró la lista a editar.' });
      }
      return;
    }

    
    if (action === 'deletePlaylist') {
      idx = parseInt((params && params.index !== undefined) ? params.index : -1, 10);

      if (idx >= 0 && idx < playlists.length) {
        var removed = playlists.splice(idx, 1);
        savePlaylists(playlists);
        if (cb) cb({
          success:            true,
          refreshPreferences: true,
          message:            '🗑️ Lista "' + removed[0].name + '" eliminada.'
        });
      } else {
        if (cb) cb({ success: false, message: 'No se encontró la lista a eliminar.' });
      }
      return;
    }

    if (cb) cb({ success: false, message: 'Acción no reconocida: ' + action });
  }

  
  
  
  globalThis.getHome            = getHome;
  globalThis.search             = search;
  globalThis.load               = load;
  globalThis.loadStreams         = loadStreams;
  globalThis.getSettings        = getSettings;
  globalThis.onPreferenceAction = onPreferenceAction;

})();
