/*
 *  libm3u — provider playlist M3U/M3U8 per xctv.
 *  Espone la stessa interfaccia di libxtream (checkLogin,
 *  getLiveCategories, getLiveStreams, ...) cosi' il plugin
 *  tratta tutti i provider allo stesso modo.
 *
 *  Attributi riconosciuti su #EXTINF: tvg-id, tvg-name,
 *  tvg-logo, group-title, tvg-chno, tv_archive.
 *  L'header #EXTM3U url-tvg / x-tvg-url fornisce la sorgente
 *  XMLTV quando cfg.epgUrl non e' impostata.
 *  Euristica VOD/serie sul group-title: vod|film|movie → VOD,
 *  serie|series → serie.
 */

var http = require('movian/http');

function M3U(url, options) {

    var opts = options || {};
    var list = null;        // entries raw
    var byGroup = null;     // group-title -> [entry]
    var epgSrc = '';

    function _debug(message, tag) {
        if(opts.debug) console.log(message, tag);
    }

    function _load() {
        if(list) return true;
        try {
            var v = http.request(url, {
                method: 'GET',
                headers: opts.headers || {},
                noFollow: false
            });
            var txt = v.toString();
            if(!txt || txt.indexOf('#EXTM3U') == -1 &&
               txt.indexOf('#EXTINF') == -1) {
                return false;
            }
            list = _parse(txt);
            _debug('parsed ' + list.length + ' entries', 'M3U');
            return true;
        } catch(e) {
            _debug('load failed: ' + e, 'M3U');
            return false;
        }
    }

    function _attr(line, name) {
        var m = line.match(new RegExp(name + '="([^"]*)"'));
        return m ? m[1] : '';
    }

    function _parse(txt) {
        var entries = [];
        var lines = txt.split(/\r?\n/);
        var cur = null;
        byGroup = {};
        epgSrc = '';
        for(var i = 0; i < lines.length; i++) {
            var ln = lines[i].replace(/^\s+|\s+$/g, '');
            if(!ln) continue;
            if(ln.indexOf('#EXTM3U') == 0) {
                epgSrc = _attr(ln, 'url-tvg') ||
                         _attr(ln, 'x-tvg-url') || epgSrc;
                continue;
            }
            if(ln.indexOf('#EXTINF') == 0) {
                var comma = ln.indexOf(',');
                cur = {
                    title: comma >= 0 ? ln.substr(comma + 1).replace(/^\s+|\s+$/g, '') : 'Unknown',
                    epgid: _attr(ln, 'tvg-id') || _attr(ln, 'tvg-name'),
                    icon: _attr(ln, 'tvg-logo'),
                    group: _attr(ln, 'group-title') || 'Generale',
                    chno: _attr(ln, 'tvg-chno'),
                    archive: _attr(ln, 'tv_archive') == '1',
                    url: ''
                };
                continue;
            }
            if(ln.charAt(0) == '#') continue;   // altri tag: skip
            if(cur) {
                cur.url = ln;
                entries.push(cur);
                if(!byGroup[cur.group]) byGroup[cur.group] = [];
                byGroup[cur.group].push(cur);
                cur = null;
            }
        }
        return entries;
    }

    function _gid(g) {
        // id numerico stabile dal nome gruppo (hash semplice)
        var h = 0;
        for(var i = 0; i < g.length; i++)
            h = ((h << 5) - h + g.charCodeAt(i)) | 0;
        return String(Math.abs(h));
    }

    function _kind(g) {
        if(/vod|film|movie|cinema/i.test(g)) return 'vod';
        if(/serie|series|tv\s*show/i.test(g)) return 'series';
        return 'live';
    }

    function _stream(e, i) {
        return {
            id: i,
            cat_id: _gid(e.group),
            title: e.title,
            icon: e.icon || '',
            epgid: e.epgid || '',
            archive: !!e.archive,
            chno: e.chno || '',
            source: { url: e.url }
        };
    }

    function _entries(pred) {
        if(!_load()) return [];
        var out = [];
        for(var i = 0; i < list.length; i++)
            if(pred(list[i])) out.push(_stream(list[i], i));
        return out;
    }

    // ---- interfaccia provider (come libxtream) ----

    this.checkLogin = function() {
        try {
            if(!_load())
                return { status: false,
                         error: 'Playlist non valida o non raggiungibile' };
            return {
                status: true,
                error: '',
                user_info: { username: 'm3u',
                             max_connections: '0',
                             allowed_output_formats: ['m3u8', 'ts'] },
                server_info: { url: url }
            };
        } catch(e) {
            return { status: false, error: String(e) };
        }
    };

    this.getInfo = function(action) {
        var res = this.checkLogin();
        if(!res.status) return false;
        switch(action) {
        case 'user': return res.user_info;
        case 'server': return res.server_info;
        default: return res;
        }
    };

    this.getLiveCategories = function() {
        if(!_load()) return [];
        var seen = {}, cats = [];
        for(var g in byGroup) {
            if(_kind(g) != 'live' || seen[g]) continue;
            seen[g] = 1;
            cats.push({ id: _gid(g), title: g });
        }
        return cats;
    };

    this.getLiveStreams = function() {
        return _entries(function(e) { return _kind(e.group) == 'live'; });
    };

    this.getLiveStreamsByCategoryId = function(id) {
        return _entries(function(e) {
            return _kind(e.group) == 'live' && _gid(e.group) == String(id);
        });
    };

    this.getVodCategories = function() {
        if(!_load()) return [];
        var seen = {}, cats = [];
        for(var g in byGroup) {
            if(_kind(g) != 'vod' || seen[g]) continue;
            seen[g] = 1;
            cats.push({ id: _gid(g), title: g });
        }
        return cats;
    };

    this.getVodStreams = function() {
        return _entries(function(e) { return _kind(e.group) == 'vod'; });
    };

    this.getVodStreamsByCategoryId = function(id) {
        return _entries(function(e) {
            return _kind(e.group) == 'vod' && _gid(e.group) == String(id);
        });
    };

    this.getVodInfo = function(id) {
        // nessun metadato esterno in M3U: risponde una scheda
        // minima con URL giocabile cosi' il dettaglio funziona
        if(!_load()) return false;
        var e = list[parseInt(id, 10)];
        if(!e) return false;
        return {
            title: e.title,
            icon: e.icon || '',
            genre: e.group,
            description: '',
            source: { url: e.url }
        };
    };

    this.getSeriesCategories = function() {
        if(!_load()) return [];
        var seen = {}, cats = [];
        for(var g in byGroup) {
            if(_kind(g) != 'series' || seen[g]) continue;
            seen[g] = 1;
            cats.push({ id: _gid(g), title: g });
        }
        return cats;
    };

    this.getSeries = function() {
        return _entries(function(e) { return _kind(e.group) == 'series'; });
    };

    this.getSeriesByCategoryId = function(id) {
        return _entries(function(e) {
            return _kind(e.group) == 'series' && _gid(e.group) == String(id);
        });
    };

    this.getSeriesInfo = function(id) {
        return false;
    };

    this.getShortEpg = function(stream_id, limit) {
        return { epg_listings: [] };
    };

    this.getEpg = function() {
        if(!epgSrc && list === null) _load();
        if(!epgSrc) return false;
        try {
            return http.request(epgSrc, { method: 'GET',
                                          compression: true }).toString();
        } catch(e) {
            return false;
        }
    };

    this.getCatchupUrl = function(stream_id, start, durationMin) {
        return false;   // catch-up non standard in M3U
    };
}

module.exports = M3U;
