/**
 *  libxtream is a module for movian
 *
 *  Copyright (C) 2017 czz78
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program. If not, see <http://www.gnu.org/licenses/>.
 */


/*
 * JavaScript uses prototypes and does't have classes (or methods for that matter) like Object Oriented languages.
 * JavaScript developer need to think in JavaScript.
 *  Wikipedia quote:
 *  Unlike many object-oriented languages, there is no distinction between a function definition and a method definition.
 *  Rather, the distinction occurs during function calling; when a function is called as a method of an object,
 *  the function's local this keyword is bound to that object for that invocation.
 */


var http = require('movian/http');

var Xtream = (function () {

    var _USER_AGENT = 'VLC/3.0.8 LibVLC/3.0.8';


    /*
     *  Normalize a user supplied server string to "scheme://host[:port]"
     *  Accepts: "host", "host:port", "http://host", "https://host:port"
     *  and even "host:port/path" (path is dropped, Xtream lives at root).
     */
    function _normalizeBase(server, defprotocol) {

        if(!server || typeof server != 'string')
            return undefined;

        server = server.replace(/^\s+|\s+$/g, '');

        var m = server.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
        var scheme, rest;

        if(m) {
            scheme = m[1].toLowerCase();
            rest = m[2];
        } else {
            scheme = defprotocol || 'http';
            rest = server;
        }

        rest = rest.split('/')[0];          // drop any path
        rest = rest.split('?')[0];          // drop any query
        rest = rest.replace(/\/+$/, '');

        if(!rest)
            return undefined;

        if(scheme != 'http' && scheme != 'https')
            scheme = 'http';

        return scheme + '://' + rest;
    }


    /* construct */
    function Xtream(base_url, credentials, options) {

        options = (options === Object(options) &&
                   Object.prototype.toString.call(options) !== '[object Array]') ? options : {};

        credentials = (credentials === Object(credentials) &&
                       Object.prototype.toString.call(credentials) !== '[object Array]') ? credentials : {};

        this.options = function () {
            return  {
                      debug : options.debug ? true : false,
                      protocol : options.protocol ? options.protocol : 'http',
                      liveExt : options.liveExt ? options.liveExt : 'auto',
                      vodExt : options.vodExt ? options.vodExt : 'auto',
                    };
        };

        this.credentials = function () {
            return  {
                      username : credentials.username ? credentials.username : undefined,
                      password : credentials.password ? credentials.password : undefined,
                    };
        };

        base_url = (base_url === Object(base_url) &&
                    Object.prototype.toString.call(base_url) !== '[object Array]') ? base_url : {};

        var proto = this.options().protocol;

        var playerBase = _normalizeBase(base_url.player_api, proto);
        var epgBase    = _normalizeBase(base_url.epg, proto) || playerBase;

        this.baseUrl = function () {
            return  {
                      playerApi : playerBase,
                      epg : epgBase
                    };
        };

        // Cache di sessione breve per le risposte API: le liste
        // pesanti (stream, categorie, info) non si riscaricano
        // per ogni pagina/categoria.
        var _cache = {};
        this._cached = function(key, ttlSecs, fn) {
            var now = Math.floor(Date.now() / 1000);
            if(_cache[key] && (now - _cache[key].t) < ttlSecs)
                return _cache[key].v;
            var v = fn();
            if(v) _cache[key] = { t: now, v: v };
            return v;
        };

        // getter for player url
        this.playerUrl = function () {
            return this.baseUrl().playerApi + "/player_api.php";
        };

        // getter for epg url (full xmltv)
        this.epgUrl = function () {
            return this.baseUrl().epg + "/xmltv.php";
        };

        // getter for user agent
        this.userAgent = function () {
            return  _USER_AGENT;
        };

    }


    /******* Methods ********/

    /*
     * Private method Debug
     */
    function _debug(message, tag, force) {
        if(typeof(force) == 'undefined' || force !== true) force = false;
        if(this.options().debug || force ) console.log(message, tag);
    }


    /*
     *  Validate that a JSON payload plausibly belongs to the requested
     *  action. Category lists carry category_id+category_name and no
     *  'name'; stream/series lists carry 'name' and never category_name.
     */
    function _shapeOk(action, parsed) {

        if(parsed === null || typeof parsed != 'object')
            return true;    // errors/other payloads pass through

        var isArr = Object.prototype.toString.call(parsed) === '[object Array]';

        switch(action) {
        case 'get_live_categories':
        case 'get_vod_categories':
        case 'get_series_categories':
            if(!isArr) return false;
            if(!parsed.length) return true;
            return parsed[0].category_name !== undefined &&
                   parsed[0].name === undefined;

        case 'get_live_streams':
        case 'get_vod_streams':
        case 'get_series':
            if(!isArr) return false;
            if(!parsed.length) return true;
            return parsed[0].name !== undefined &&
                   parsed[0].category_name === undefined;

        case 'get_short_epg':
            return parsed.epg_listings !== undefined;
        }

        return true;
    }


    /*
     * Private method req — GET on player_api.php with query args.
     * When statuscode === true, returns the HTTP status code instead
     * of the parsed JSON body.
     */
    function _req(data, statuscode) {

        var res = false;

        if(!this.credentials().username || !this.credentials().password)
            return res;

        var url = this.playerUrl() +
                  "?username=" + encodeURIComponent(this.credentials().username) +
                  "&password=" + encodeURIComponent(this.credentials().password);

        if (data === Object(data) && Object.prototype.toString.call(data) !== '[object Array]') {
            for(var k in data)
                url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(data[k]);
        }

        var s = { method: "GET",
                  debug: this.options().debug,
                  compression: false,
                  connectTimeout: 5000,
                  readTimeout: 15000,
                  headers: { 'User-Agent' : this.userAgent() }
                 };

        try {

            var v = http.request(url, s);

            if(statuscode === true)
                return v.statuscode;

            var body = v.toString();
            if(!body || body.length < 2)
                return res;

            var parsed = JSON.parse(body);

            // Payload-shape guard: if a response ever arrives for the wrong
            // endpoint (e.g. swapped by a concurrent request), reject it
            // instead of silently mapping it to "Unknown" rows.
            if(!_shapeOk(data && data.action, parsed)) {
                _debug.call(this, 'Bad response shape for ' + data.action +
                    ' => ' + body.substring(0, 80), 'Xtream', true);
                return res;
            }

            return parsed;

        }
        catch (e) {
            _debug.call(this,  e.toString().replace('\n', ''), 'Xtream', true );
        }

        return res;

    }


    /*
     *  Fetch the full XMLTV document (xmltv.php).
     *  Returns the raw xml string or false.
     */
    function _reqEpgRaw() {

        var res = false;

        if(!this.credentials().username || !this.credentials().password)
            return res;

        var url = this.epgUrl() +
                  "?username=" + encodeURIComponent(this.credentials().username) +
                  "&password=" + encodeURIComponent(this.credentials().password);

        var s = { method: "GET",
                  debug: this.options().debug,
                  compression: true,
                  connectTimeout: 5000,
                  readTimeout: 120000,   // xmltv.php puo' essere enorme
                  headers: { 'User-Agent' : this.userAgent() }
                 };

        try {
            var v = http.request(url, s);
            var body = v.toString();
            if(body && body.indexOf('<') != -1)
                res = body;
        }
        catch (e) {
            _debug.call(this,  e.toString().replace('\n', ''), 'Xtream:_reqEpgRaw', true );
        }

        return res;

    }


    /*
     *  base64 decode helper (get_short_epg titles/descs are b64).
     */
    function _b64d(s) {
        if(!s) return '';
        try {
            return String(Duktape.dec('base64', s));
        } catch(e) {
            return s;
        }
    }


    /*
     *  Account / login check.
     *  Returns {status: bool, error: string}
     */
    Xtream.prototype.checkLogin = function () {

        if(!this.credentials().username || !this.credentials().password)
            return {status : false, error: "No credentials set"};

        // Una sola request sul percorso felice: la risposta resta
        // nella cache '_info' e serve gratis a liveExtension() ecc.
        var self = this;
        var res = this._cached('_info', 600, function() {
            return _req.call(self);
        });

        _debug.call(this, JSON.stringify(res), "Xtream:checkLogin");

        if(res && res.user_info) {
            if(String(res.user_info.auth) == '0')
                return {status : false, error: "Authentication failed (auth=0)"};
            return {status : true, error: ''};
        }

        // Fallita: una request di sola status per il messaggio d'errore
        var code = _req.call(this, {}, true);
        switch(code) {
            case 502:
                return {status : false, error: "Bad Gateway" };
            case 503:
                return {status : false, error: "Service Unavailable" };
            default:
                return {status : false, error: "Something went wrong, maybe wrong credentials or expired (HTTP " + code + ")"};
        }

    };


    /*
     *  Get infos of your account
     *  returns object data
     */
    Xtream.prototype.getInfo = function (action) {

        var self = this;
        var res = this._cached('_info', 600, function() {
            return _req.call(self);
        });

        _debug.call(this, JSON.stringify(res), "Xtream:getInfo");

        if(!res) return false;

        switch (action) {

            case "user":
                return res.user_info;
            case "server":
                return res.server_info;
            default:
                return res;
        }

    };


    /*
     *  Preferred live output extension ("m3u8" or "ts") taken from
     *  user_info.allowed_output_formats, defaulting to m3u8.
     *  options.liveExt ('auto'|'m3u8'|'ts') forces the choice.
     */
    Xtream.prototype.liveExtension = function() {

        var forced = this.options().liveExt;
        if(forced && forced != 'auto')
            return forced;

        var ext = 'm3u8';

        var user = this.getInfo('user');
        if(user && user.allowed_output_formats) {
            var fmts = user.allowed_output_formats;
            if(fmts.indexOf('m3u8') == -1 && fmts.indexOf('ts') != -1)
                ext = 'ts';
        }

        return ext;
    };


    /*
     *  VOD container extension: res.container_extension unless
     *  options.vodExt ('auto'|'mkv'|'mp4'|'avi') forces it.
     */
    Xtream.prototype.vodExtension = function(containerExt) {

        var forced = this.options().vodExt;
        if(forced && forced != 'auto')
            return forced;

        return containerExt ? containerExt : 'mp4';
    };


    /*
     *  Live Categories
     *  Returns an array of live categories
     *  { id: id, title: title, icon: url }
     */
    Xtream.prototype.getLiveCategories = function() {

        var cats = [];
        var self = this;
        var res = this._cached('_livecats', 300, function() {
            return _req.call(self, { action: "get_live_categories" });
        });
        _debug.call(this, JSON.stringify(res), "Xtream:getLiveCategories");

        if(res) {
           for(var i in res) {
              cats.push({ id: res[i].category_id ?  res[i].category_id :  '0',
                          title: res[i].category_name && res[i].category_name != 'undefined' ? res[i].category_name :  'Unknown',
                          icon: Plugin.path + 'images/livetv.png'
                        });
           }
        }

        return cats;

    };


    /*
     *  Live Streams
     *  Returns an array of live streams. Each element of the array is an object.
     *  { id, cat_id, title, icon, epgid, source:{ url } }
     */
    Xtream.prototype.getLiveStreams = function() {

        var live = [];

        var self = this;
        var res = this._cached('_live', 300, function() {
            return _req.call(self, { action: "get_live_streams" });
        });
        _debug.call(this, JSON.stringify(res), "Xtream:getLiveStreams");

        var ext = this.liveExtension();

        if(res) {
           for(var i in res) {

              live.push({ id: res[i].stream_id ?  res[i].stream_id :  0,
                             cat_id: res[i].category_id ?  res[i].category_id :  '0',
                             title: res[i].name  ? res[i].name :  'Unknown',
                             icon: (res[i].stream_icon && res[i].stream_icon != '') ? res[i].stream_icon : Plugin.path + 'images/livetv.png',
                             epgid: res[i].epg_channel_id ? res[i].epg_channel_id : '',
                             archive: res[i].tv_archive == 1 || res[i].tv_archive === true,
                             source:{url:    this.baseUrl().playerApi + "/live/" + this.credentials().username + "/" + this.credentials().password + "/" + res[i].stream_id + "." + ext }
                           });
           }
        }

        return live;

    };


    /*
     *  Catch-up (timeshift) playback URL for a live stream with
     *  tv_archive. start is unix seconds, durationMin the length of
     *  the programme in minutes.
     *  Format: {base}/timeshift/{user}/{pass}/{mins}/{Y-m-d:H-i}/{id}.{ext}
     */
    Xtream.prototype.getCatchupUrl = function(stream_id, start, durationMin) {

        var d = new Date(start * 1000);
        var pad = function(x) { return (x < 10 ? '0' : '') + x; };
        var ts = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' +
                 pad(d.getDate()) + ':' + pad(d.getHours()) + '-' +
                 pad(d.getMinutes());

        if(!durationMin || durationMin < 1)
            durationMin = 60;

        return this.baseUrl().playerApi + "/timeshift/" +
               this.credentials().username + "/" + this.credentials().password +
               "/" + Math.ceil(durationMin) + "/" + ts + "/" + stream_id + "." +
               this.liveExtension();
    };


    /*
     *  Live Streams by category id
     */
    Xtream.prototype.getLiveStreamsByCategoryId = function(id) {

        var streams = [];

        var res = (this).getLiveStreams();

        if(res) {

           for(var i in res) {

              if( String(id) == '0' ) {
                 if( res[i].cat_id == '' || res[i].cat_id == '0' ){
                    delete res[i].cat_id;
                    streams.push(res[i]);
                 }
              }

              else {
                if( res[i].cat_id == id ){

                    delete res[i].cat_id;
                    streams.push(res[i]);

                }
              }
           }
        }

        return streams;

    };


    /*
     *  Short EPG (now/next) for a single live stream via
     *  action=get_short_epg&stream_id=N&limit=M
     *  Returns an array of { title, desc, start, stop, icon } sorted by start.
     *  start/stop are unix seconds.
     */
    function _shortEpgEvents(res) {

        var events = [];

        if(res && res.epg_listings) {
            for(var i in res.epg_listings) {

                var l = res.epg_listings[i];

                var start = l.start_timestamp ? parseInt(l.start_timestamp, 10) :
                            (l.start ? Math.floor(new Date(l.start.replace(' ', 'T')).getTime()/1000) : 0);
                var stop  = l.stop_timestamp  ? parseInt(l.stop_timestamp, 10)  :
                            (l.stop  ? Math.floor(new Date(l.stop.replace(' ', 'T')).getTime()/1000)  : 0);

                if(!start)
                    continue;
                if(!stop || stop <= start)
                    stop = start + 3600;

                events.push({ title: _b64d(l.title),
                              desc: _b64d(l.description),
                              start: start,
                              stop: stop });
            }
        }

        events.sort(function(a, b) { return a.start - b.start; });
        return events;
    }


    Xtream.prototype.getShortEpg = function(stream_id, limit) {

        var data = { action: "get_short_epg", stream_id: stream_id };
        if(limit)
            data.limit = limit;

        var res = _req.call(this, data);
        _debug.call(this, JSON.stringify(res), "Xtream:getShortEpg");

        return _shortEpgEvents(res);
    };


    /*
     *  Async variant: the fetch runs on a runtime task thread and
     *  cb(eventsOrFalse) fires when done — the JS/UI thread never
     *  blocks. Used to fill grid rows with now/next instantly,
     *  before the full XMLTV guide is ready.
     */
    Xtream.prototype.getShortEpgAsync = function(stream_id, limit, cb) {

        if(!this.credentials().username || !this.credentials().password) {
            cb(false);
            return;
        }

        var url = this.playerUrl() +
                  "?username=" + encodeURIComponent(this.credentials().username) +
                  "&password=" + encodeURIComponent(this.credentials().password) +
                  "&action=get_short_epg&stream_id=" +
                  encodeURIComponent(stream_id);
        if(limit)
            url += "&limit=" + limit;

        var s = { method: "GET",
                  debug: this.options().debug,
                  compression: false,
                  connectTimeout: 5000,
                  readTimeout: 15000,
                  headers: { 'User-Agent' : this.userAgent() }
                 };

        var self = this;
        try {
            http.request(url, s, function(err, res) {
                var evs = false;
                try {
                    if(!err && res) {
                        var parsed = JSON.parse(res.toString());
                        if(_shapeOk('get_short_epg', parsed))
                            evs = _shortEpgEvents(parsed);
                    }
                } catch(e) {}
                try { cb(evs); } catch(e) {}
            });
        } catch(e) {
            cb(false);
        }
    };


    /*
     *  Full XMLTV guide (xmltv.php). Returns the raw XML string
     *  (parsing is left to libxmltv) or false.
     */
    Xtream.prototype.getEpg = function() {

        return _reqEpgRaw.call(this);

    };


    /*
     *  Async variant of getEpg: cb(bodyOrFalse) fires when the
     *  download completes — the fetch runs on a task thread so the
     *  UI stays responsive while xmltv.php transfers.
     */
    Xtream.prototype.getEpgAsync = function(cb) {

        if(!this.credentials().username || !this.credentials().password) {
            cb(false);
            return;
        }

        var url = this.epgUrl() +
                  "?username=" + encodeURIComponent(this.credentials().username) +
                  "&password=" + encodeURIComponent(this.credentials().password);

        var s = { method: "GET",
                  debug: this.options().debug,
                  compression: true,
                  connectTimeout: 5000,
                  readTimeout: 120000,
                  headers: { 'User-Agent' : this.userAgent() }
                 };

        var self = this;
        try {
            http.request(url, s, function(err, res) {
                var body = false;
                try {
                    if(!err && res)
                        body = res.toString();
                    if(body && body.indexOf('<') == -1)
                        body = false;
                } catch(e) {
                    body = false;
                }
                try { cb(body); } catch(e2) {}
            });
        } catch(e) {
            _debug.call(self, e.toString().replace('\n', ''),
                        'Xtream:getEpgAsync', true);
            cb(false);
        }
    };


    /*
     *  Vod Categories
     *  Returns an array of vod categories.
     *  [{ id: category_id, title: category_name, icon: icon }]
     */
    Xtream.prototype.getVodCategories = function() {

        var cats = [];

        var self = this;
        var res = this._cached('_vodcats', 300, function() {
            return _req.call(self, { action: "get_vod_categories" });
        });
        _debug.call(this, JSON.stringify(res), "Xtream:getVodCategories");

        if(res) {
           for(var i in res) {
              cats.push({ id: res[i].category_id ?  res[i].category_id :  '0',
                          title: res[i].category_name  ? res[i].category_name :  'Unknown',
                          icon: Plugin.path + 'images/vod.png'
                        });
           }
        }

        return cats;

    };


    /*
     *  Vod Streams
     *  Returns an array of vod streams.
     *  [{ id, cat_id, title, icon, rating, year, source:{ url } }]
     */
    Xtream.prototype.getVodStreams = function() {

        var streams = [];

        var self = this;
        var res = this._cached('_vod', 300, function() {
            return _req.call(self, { action: "get_vod_streams" });
        });
        _debug.call(this, JSON.stringify(res), "Xtream:getVodStreams");

        if(res) {
           for(var i in res) {

              var ext = this.vodExtension(res[i].container_extension);

              streams.push({ id: res[i].stream_id ?  res[i].stream_id :  0,
                             cat_id: res[i].category_id ?  res[i].category_id :  '0',
                             title: res[i].name ? res[i].name :  'Unknown',
                             icon: (res[i].stream_icon && res[i].stream_icon != '') ? res[i].stream_icon : Plugin.path + 'images/vod.png',
                             rating: res[i].rating_5based ? res[i].rating_5based : (res[i].rating ? res[i].rating : ''),
                             added: parseInt(res[i].added, 10) || 0,
                             source:{url:    this.baseUrl().playerApi + "/movie/" + this.credentials().username + "/" + this.credentials().password + "/" + res[i].stream_id + "." + ext}
                           });
           }
        }


        return streams;

    };


    /*
     *  Vod Streams by category id
     */
    Xtream.prototype.getVodStreamsByCategoryId = function(id) {

        var streams = [];

        var res = (this).getVodStreams();

        if(res) {

           for(var i in res) {

              if( res[i].cat_id == id ){

                  delete res[i].cat_id;
                  streams.push(res[i]);

              }
           }
        }

        return streams;

    };


    /*
     *  Vod Info
     *  Returns a showtime video object
     */
    Xtream.prototype.getVodInfo = function(id) {

        var res = _req.call(this, { action: "get_vod_info", vod_id: id});
        _debug.call(this, JSON.stringify(res), "Xtream:getVodInfo");

        if(!res || !res.movie_data)
            return false;

        var cn = res.info && res.info.video && res.info.video.codec_name ? res.info.video.codec_name : '';
        var cw = res.info && res.info.video && res.info.video.coded_width ? res.info.video.coded_width : (res.info && res.info.video && res.info.video.width ? res.info.video.width : '');
        var ch = res.info && res.info.video && res.info.video.coded_height ? res.info.video.coded_height : (res.info && res.info.video && res.info.video.height ? res.info.video.height : '');
        var au = res.info && res.info.audio && res.info.audio.codec_name ? res.info.audio.codec_name : (res.info && res.info.audio ? res.info.audio : '');
        var cast = res.info && res.info.cast ? res.info.cast: '';
        var dir = res.info && res.info.director ? res.info.director: '';
        var plot = res.info && res.info.plot ? res.info.plot: '';

        var ext = this.vodExtension(res.movie_data.container_extension);

        var backdrop = '';
        if(res.info && res.info.backdrop_path && res.info.backdrop_path.length)
            backdrop = res.info.backdrop_path[0];

        return  { id: res.movie_data.stream_id,
                  title: res.movie_data.name ? res.movie_data.name : 'unknown',
                  icon: res.info && res.info.movie_image ? res.info.movie_image: Plugin.path + "images/vod.png",
                  backdrop: backdrop,
                  tagline: cn+" "+ cw+'x'+ch + ' - ' + au,
                  genre: res.info && res.info.genre ? res.info.genre : 'unknown',
                  description: (cast ? "Cast: " + cast + "\n" : '') + (dir ? "Regia: " + dir + "\n\n" : '') + plot ,
                  rating: res.info && res.info.rating ? res.info.rating : '',
                  year: res.info && res.info.releasedate ? res.info.releasedate : (res.info && res.info.releaseDate ? res.info.releaseDate : ''),
                  duration: res.info && res.info.duration ? res.info.duration: '',
                  source:{url:    this.baseUrl().playerApi + "/movie/" + this.credentials().username + "/" + this.credentials().password + "/" + id+ "." + ext}
         };

    };


    Xtream.prototype.getSeries = function() {

        var series = [];

        var self = this;
        var res = this._cached('_series', 300, function() {
            return _req.call(self, { action: "get_series" });
        });
        _debug.call(this, JSON.stringify(res), "Xtream:getSeriesStreams request");

        if(res) {
           for(var i in res) {

              var cast = res[i].cast ? res[i].cast : '';
              var dir = res[i].director ? res[i].director: '';
              var plot = res[i].plot ? res[i].plot: '';

              series.push({ id: res[i].series_id ?  res[i].series_id :  0,
                            cat_id: res[i].category_id ?  res[i].category_id :  '0',
                            title: res[i].name  ? res[i].name :  'Unknown',
                            icon: res[i].cover && res[i].cover != '' ? res[i].cover : Plugin.path + "images/series.png",
                            tagline: res[i].episode_run_time ? res[i].episode_run_time : "?",
                            genre: res[i].genre ? res[i].genre : 'unknown',
                            description: (cast ? "Cast: " + cast + " - " : '') + (dir ? dir + "\n" : '') + plot ,
                            rating: res[i].rating ? res[i].rating : '',
                            added: parseInt(res[i].last_modified, 10) || parseInt(res[i].added, 10) || 0,
                            year: res[i].releaseDate ? res[i].releaseDate : '',
                            source:{url:    this.baseUrl().playerApi + "/series/" + this.credentials().username + "/" + this.credentials().password + "/" + res[i].series_id+ ".mp4"}
                        });
           }
        }

        _debug.call(this, JSON.stringify(series), "Xtream:getSeriesStreams stream return");

        return series;

    };


    /*
     *  Series Categories
     *  Returns an array of series categories.
     *  { id: id, title: title, icon: icon }
     */
    Xtream.prototype.getSeriesCategories = function() {
        var cats = [];

        var self = this;
        var res = this._cached('_seriescats', 300, function() {
            return _req.call(self, { action: "get_series_categories" });
        });
        _debug.call(this, JSON.stringify(res), "Xtream:getSeriesCategories");

        if(res) {
           for(var i in res) {
              cats.push({ id: res[i].category_id ?  res[i].category_id :  '0',
                          title: res[i].category_name  ? res[i].category_name :  'Unknown',
                          icon: Plugin.path + 'images/series.png'
                        });
           }
        }

        return cats;


    };


    /*
     *  Series by category id
     */
    Xtream.prototype.getSeriesByCategoryId = function(id) {

        var streams = [];

        var res = (this).getSeries();

        if(res) {
           for(var i in res) {

              if( res[i].cat_id == id ){
                  delete res[i].cat_id;
                  streams.push(res[i]);
              }
           }
        }

        return streams;

    };


    /*
     *  Series Info
     *  Returns an array of episodes (all seasons flattened).
     */
    Xtream.prototype.getSeriesInfo = function(id) {

        var series = [];

        var res = _req.call(this, { action: "get_series_info", series_id: id});
        _debug.call(this, JSON.stringify(res), "Xtream:getSeriesInfo");

        if(res && res.episodes){
            for (var i in res.episodes) {
                for(var j in res.episodes[i] ){

                    var ep = res.episodes[i][j];

                    var cn = ep.info && ep.info.video && ep.info.video.codec_name ? ep.info.video.codec_name : '';
                    var cw = ep.info && ep.info.video && ep.info.video.coded_width ? ep.info.video.coded_width : '';
                    var ch = ep.info && ep.info.video && ep.info.video.coded_height ? ep.info.video.coded_height : '';
                    var au = ep.info && ep.info.audio && ep.info.audio.codec_name ? ep.info.audio.codec_name : '';

                    var ext = this.vodExtension(ep.container_extension);

                    series.push({ id: ep.id,
                                  title: ep.title ? ep.title : 'unknown',
                                  icon: res.info && res.info.cover ? res.info.cover: Plugin.path + "images/series.png",
                                  tagline: cn+" "+ cw+'x'+ch + ' - ' + au,
                                  genre: res.info && res.info.genre ? res.info.genre : 'unknown',
                                  year: res.info && res.info.releaseDate ? res.info.releaseDate: '',
                                  vtype: 'tvseries' ,
                                  season: {number: ep.season},
                                  episode: {title: ep.title ? ep.title : 'unknown' ,number: ep.episode_num},
                                  duration: ep.info && ep.info.duration ? ep.info.duration: '',
                                  source:{url:    this.baseUrl().playerApi + "/series/" + this.credentials().username + "/" + this.credentials().password + "/" + ep.id+ "." + ext}
                                 });
                }
            }
        }

         return series;

    };


    return Xtream;

})();


module.exports = Xtream;
