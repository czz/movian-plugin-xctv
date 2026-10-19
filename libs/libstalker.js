/*
 *  libstalker — provider portale Stalker/Ministra per xctv.
 *  Stessa interfaccia di libxtream.
 *
 *  cfg.server   = URL del portale (es. http://host/portal.php
 *                 oppure http://host/stalker_portal/c/)
 *  cfg.username = MAC address (aa:bb:cc:dd:ee:ff)
 *  cfg.password = non usato (alcuni portali chiedono device_id)
 *
 *  Flusso: handshake → token Bearer → get_profile →
 *  itv/vod/series get_ordered_list. I "cmd" dei canali vanno
 *  risolti con create_link per ottenere l'URL stream reale.
 */

var http = require('movian/http');

function Stalker(portal, credentials, options) {

    var cred = credentials || {};
    var opts = options || {};
    var mac = String(cred.username || '').toUpperCase();
    var token = null;
    var base = null;

    function _debug(message, tag) {
        if(opts.debug) console.log(message, tag);
    }

    function _base() {
        if(base) return base;
        var p = String(portal || '');
        // normalizza: toglie l'eventuale suffisso noto
        p = p.replace(/\/+$/, '');
        if(/portal\.php$/.test(p))
            base = p;
        else if(/\/c\/?$/.test(p))
            base = p.replace(/\/c\/?$/, '') + '/server/load.php';
        else
            base = p + '/portal.php';
        return base;
    }

    function _req(params) {
        var url = _base() + '?';
        for(var k in params)
            url += encodeURIComponent(k) + '=' +
                   encodeURIComponent(params[k]) + '&';
        url += 'JsHttpRequest=1-xml';

        var headers = {
            'Cookie': 'mac=' + mac + '; stb_lang=en; timezone=Europe/Rome',
            'Referer': _base().replace(/[^/]*$/, '') + 'c/',
            'User-Agent': opts.ua ||
                'Mozilla/5.0 (QtEmbedded; U; Linux; C) ' +
                'AppleWebKit/533.3 (KHTML, like Gecko) ' +
                'MAG200 stbapp ver: 4 rev: 2721 Safari/533.3'
        };
        for(var h in (opts.headers || {})) headers[h] = opts.headers[h];
        if(token) headers['Authorization'] = 'Bearer ' + token;

        var v = http.request(url, { method: 'GET', headers: headers });
        var txt = v.toString();
        try {
            var j = JSON.parse(txt);
            return j && j.js !== undefined ? j.js : j;
        } catch(e) {
            _debug('bad JSON for ' + params.action + ': ' +
                   txt.substring(0, 120), 'Stalker');
            return false;
        }
    }

    function _handshake() {
        if(token) return true;
        var j = _req({ type: 'stb', action: 'handshake', token: '' });
        if(j && j.token) { token = j.token; return true; }
        return false;
    }

    function _cmd2url(cmd) {
        // "ffmpeg http://.../ch" | "auto ..." | url diretto
        if(!cmd) return '';
        cmd = String(cmd).replace(/^\s+|\s+$/g, '');
        cmd = cmd.replace(/^(ffmpeg|auto|ffrt\s+\S+)\s+/i, '');
        // risolve il link reale quando serve (localhost -> stream)
        if(cmd.indexOf('localhost') != -1 || cmd.indexOf('/ch/') != -1 ||
           /^\/|ch=/.test(cmd)) {
            try {
                var j = _req({ type: 'itv', action: 'create_link',
                               cmd: cmd });
                if(j && j.cmd)
                    return _cmd2url(j.cmd);
            } catch(e) {}
        }
        return /^https?:/.test(cmd) ? cmd : '';
    }

    function _list(type, genre) {
        if(!_handshake()) return [];
        var out = [], p = 1;
        for(;;) {
            var j = _req({ type: type, action: 'get_ordered_list',
                           genre: genre || '*', force_ch_link_check: '0',
                           fav: '0', sortby: 'number', hd: '0', p: p });
            if(!j || !j.data || !j.data.length) break;
            for(var i = 0; i < j.data.length; i++) out.push(j.data[i]);
            var total = parseInt(j.total_items, 10) || 0;
            if(out.length >= total || j.data.length < 10 || p > 50)
                break;
            p++;
        }
        return out;
    }

    function _genres(type) {
        if(!_handshake()) return [];
        var j = _req({ type: type, action: 'get_genres' });
        if(!j) return [];
        var arr = j;
        if(!Array.isArray(arr)) {
            arr = [];
            for(var k in j) if(j[k] && j[k].id) arr.push(j[k]);
        }
        return arr;
    }

    this.checkLogin = function() {
        try {
            if(!_handshake())
                return { status: false,
                         error: 'Handshake fallito (MAC valida?)' };
            var prof = _req({ type: 'stb', action: 'get_profile' });
            if(!prof)
                return { status: false, error: 'get_profile fallito' };
            return {
                status: true, error: '',
                user_info: { username: mac,
                             max_connections: '0',
                             allowed_output_formats: ['m3u8', 'ts'] },
                server_info: { url: portal }
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
        var g = _genres('itv'), cats = [];
        for(var i = 0; i < g.length; i++)
            if(g[i] && g[i].id != '*')
                cats.push({ id: String(g[i].id),
                            title: g[i].title || g[i].id });
        return cats;
    };

    this.getLiveStreams = function() {
        return this.getLiveStreamsByCategoryId('*');
    };

    this.getLiveStreamsByCategoryId = function(id) {
        var raw = _list('itv', (id == null || id === '') ? '*' : String(id));
        var out = [];
        for(var i = 0; i < raw.length; i++) {
            var c = raw[i];
            out.push({
                id: c.id,
                cat_id: String(c.tv_genre_id || '0'),
                title: c.name || ('CH ' + (c.number || i)),
                icon: c.logo ? (portal.replace(/\/+$/, '') + c.logo) : '',
                epgid: c.xmltv_id || c.epg_id || '',
                archive: parseInt(c.tv_archive_duration, 10) > 0,
                chno: c.number || '',
                _cmd: c.cmd,
                source: { url: _cmd2url(c.cmd) }
            });
        }
        return out;
    };

    this.getVodCategories = function() {
        var g = _genres('vod'), cats = [];
        for(var i = 0; i < g.length; i++)
            if(g[i] && g[i].id != '*')
                cats.push({ id: String(g[i].id),
                            title: g[i].title || g[i].id });
        return cats;
    };

    this.getVodStreams = function() {
        return this.getVodStreamsByCategoryId('*');
    };

    this.getVodStreamsByCategoryId = function(id) {
        var raw = _list('vod', (id == null || id === '') ? '*' : String(id));
        var out = [];
        for(var i = 0; i < raw.length; i++) {
            var v = raw[i];
            out.push({
                id: v.id,
                cat_id: String(v.category_id || '0'),
                title: v.name || v.o_name || 'Unknown',
                icon: v.screenshot_uri || '',
                year: v.year || '',
                source: { url: '' },   // risolto in getVodInfo
                _cmd: v.cmd
            });
        }
        return out;
    };

    this.getVodInfo = function(id) {
        if(!_handshake()) return false;
        var j = _req({ type: 'vod', action: 'get_ordered_list',
                       movie_id: id });
        var v = j && j.data && j.data[0];
        if(!v) return false;
        return {
            info: {
                name: v.name, description: v.description,
                director: v.director, actors: v.actors,
                genre: v.genres_str, releasedate: v.year,
                rating: v.rating_imdb || v.rating_kinopoisk,
                duration_secs: parseInt(v.time, 10) * 60
            },
            movie_data: {
                stream_id: v.id, name: v.name,
                container_extension: 'mp4',
                url: _cmd2url(v.cmd)
            }
        };
    };

    this.getSeriesCategories = function() { return []; };
    this.getSeries = function() { return []; };
    this.getSeriesByCategoryId = function(id) { return []; };
    this.getSeriesInfo = function(id) { return false; };

    this.getShortEpg = function(stream_id, limit) {
        if(!_handshake()) return { epg_listings: [] };
        var j = _req({ type: 'itv', action: 'get_short_epg',
                       ch_id: stream_id, size: limit || 2 });
        var l = (j && j.data) || [];
        var out = [];
        for(var i = 0; i < l.length; i++)
            out.push({
                id: l[i].id, epg_id: stream_id,
                title: l[i].name, lang: '',
                start: l[i].start_timestamp,
                end: l[i].stop_timestamp,
                description: l[i].descr,
                start_timestamp: l[i].start_timestamp,
                stop_timestamp: l[i].stop_timestamp
            });
        return { epg_listings: out };
    };

    this.getEpg = function() {
        return false;   // XMLTV separato (epgUrl) o short-epg
    };

    this.getCatchupUrl = function(stream_id, start, durationMin) {
        return false;   // archivio via create_link non standardizzato
    };
}

module.exports = Stalker;
