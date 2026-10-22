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

        // peek/put per i path async: stessa cache, senza la
        // chiamata sincrona
        this._cachePeek = function(key, ttlSecs) {
            var now = Math.floor(Date.now() / 1000);
            if(_cache[key] && (now - _cache[key].t) < ttlSecs)
                return _cache[key].v;
            return undefined;
        };
        this._cachePut = function(key, v) {
            if(v) _cache[key] = { t: Math.floor(Date.now() / 1000), v: v };
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
     *  _catMatch — match categoria tollerante: category_id puo'
     *  arrivare come numero, stringa o array (item multi-categoria).
     */
    function _catMatch(cid, id) {

        var s = String(id);
        if(cid == null || cid === '') return s == '0';
        if(Object.prototype.toString.call(cid) === '[object Array]') {
            for(var i = 0; i < cid.length; i++)
                if(String(cid[i]) == s) return true;
            return false;
        }
        return String(cid) == s;
    }


    /*
     *  _jsonScan — iteratore su un array JSON "piatto" tenuto come
     *  stringa: isola un item top-level alla volta e lo restituisce
     *  parsato. JSON.parse(body) su un catalogo materializzerebbe
     *  l'intero albero dei record grezzi in un colpo — decine di
     *  migliaia di oggetti grassi coesistono fino al mapping e sui
     *  box da ~1GB il picco supera la quota (OOM kill misurato a
     *  ~400MB). Qui ogni record grezzo muore appena mappato nello
     *  slim object: il picco resta ~body + lista slim.
     *
     *  I boundary fra item si trovano con indexOf('},{') — nativo e
     *  veloce (~10x la scansione carattere-per-carattere, che sui
     *  box ARM lenti costava ~85s su 40MB). Un '},{' dentro una
     *  stringa o un oggetto annidato e' un falso boundary: il parse
     *  del frammento fallisce e il boundary si estende al '},{'
     *  successivo finche' l'item non si ricompone. Un item che non
     *  si ricompone mai viene saltato, la scansione continua.
     *  Ritorna null se il payload non e' un array; next() ritorna
     *  l'item parsato o undefined a fine lista.
     */
    function _jsonScan(body) {

        var b0 = body.indexOf('[');
        if(b0 < 0) return null;
        var rb = body.lastIndexOf(']');
        if(rb <= b0) return null;

        var i = body.indexOf('{', b0);   // gli item attesi sono oggetti
        var done = false;

        return {
            next: function() {
                while(!done) {
                    if(i < 0 || i > rb) { done = true; return undefined; }
                    var start = i;
                    var end = body.indexOf('},{', start + 1);
                    if(end < 0 || end > rb) end = rb;

                    var raw = undefined;
                    for(;;) {
                        // ultimo item: substring(start, rb) esclude ']'
                        var frag = (end == rb) ?
                            body.substring(start, rb) :
                            body.substring(start, end + 1);
                        try { raw = JSON.parse(frag); } catch(e) {}
                        if(raw !== undefined) break;
                        if(end == rb) { raw = null; break; }
                        // falso boundary: allunga al '},{' successivo
                        var nx = body.indexOf('},{', end + 3);
                        if(nx < 0 || nx > rb) { raw = null; break; }
                        end = nx;
                    }

                    if(raw !== null && raw !== undefined) {
                        if(end == rb) done = true;
                        i = end + 2;
                        return raw;
                    }

                    // item corrotto: salta al boundary successivo a
                    // start e continua — non abortire la lista
                    var nxt = body.indexOf('},{', start + 1);
                    if(nxt < 0 || nxt > rb) { done = true; return undefined; }
                    i = nxt + 2;
                }
                return undefined;
            }
        };
    }


    /*
     *  _reqList — fetch sync + scan incrementale per le action che
     *  tornano liste (stream/serie): sostituisce _req+build, il
     *  record grezzo non viene mai tenuto tutto in memoria.
     *  Ritorna { l: array slim, hc: presenza campi categoria } o
     *  false; hc serve a _catFilter per capire se il server ha
     *  davvero filtrato o se il payload non ha category_id.
     */
    function _reqList(data, itemFn) {

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
                  readTimeout: 60000,
                  headers: { 'User-Agent' : this.userAgent() }
                 };

        try {

            var v = http.request(url, s);

            var body = v.toString();
            if(!body || body.length < 2)
                return res;

            var scan = _jsonScan(body);
            if(!scan) {
                // non e' un array: shape guard come il path classico
                var parsed = JSON.parse(body);
                return _shapeOk(data && data.action, parsed) ?
                       parsed : res;
            }

            var out = [], hc = false, first = true;
            for(;;) {
                var raw = scan.next();
                if(raw === undefined) break;
                if(first) {
                    first = false;
                    if(!_shapeOk(data && data.action, [raw]))
                        return res;
                }
                if(!hc && raw &&
                   (raw.category_id != null || raw.category_ids != null))
                    hc = true;
                if(typeof raw === 'object') {
                    try { out.push(itemFn(this, raw)); } catch(e2) {}
                }
            }

            return { l: out, hc: hc };

        }
        catch (e) {
            _debug.call(this,  e.toString().replace('\n', ''), 'Xtream', true );
        }

        return res;

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
                  // liste VOD/serie possono pesare decine di MB in
                  // chiaro (compression off): 15s non bastavano su
                  // connessioni lente — 60s resta un bound ai hang
                  readTimeout: 60000,
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
     *  _reqAsync — come _req ma con callback: la pagina resta
     *  reattiva mentre la rete scarica (le liste catalogo possono
     *  pesare decine di MB). cb(parsed|false).
     *  Le richieste identiche in volo si deduppano: due pagine
     *  aperte insieme non scaricano due volte lo stesso catalogo.
     */
    var _inflight = {};
    var _inflightL = {};   // dedup delle fetch lista incrementali
    function _reqAsync(data, cb) {

        var self = this;
        if(!self.credentials().username || !self.credentials().password) {
            cb(false);
            return;
        }

        var url = self.playerUrl() +
                  "?username=" + encodeURIComponent(self.credentials().username) +
                  "&password=" + encodeURIComponent(self.credentials().password);

        if (data === Object(data) && Object.prototype.toString.call(data) !== '[object Array]') {
            for(var k in data)
                url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(data[k]);
        }

        // dedup inflight: stessa URL -> si accoda alla richiesta
        // gia' partita
        var fin;
        if(_inflight[url]) {
            _inflight[url].push(cb);
            return;
        }
        _inflight[url] = [cb];
        fin = function(out) {
            var list = _inflight[url] || [];
            delete _inflight[url];
            for(var i = 0; i < list.length; i++)
                try { list[i](out); } catch(e) {
                    _debug.call(self, '_reqAsync cb: ' + e, 'Xtream', true);
                }
        };

        var s = { method: "GET",
                  debug: self.options().debug,
                  // liste catalogo fino a ~50MB in chiaro: gzip le
                  // riduce a ~8MB. Al primo fallimento si riprova
                  // senza compressione (pannelli/proxy che rompono
                  // gzip o i redirect — il bug storico del 301).
                  compression: true,
                  connectTimeout: 5000,
                  readTimeout: 60000,
                  headers: { 'User-Agent' : self.userAgent() }
                 };

        function attempt() {
            try {
                http.request(url, s, function(err, res) {
                    var out = false;
                    try {
                        if(!err && res) {
                            var body = res.toString();
                            if(body && body.length >= 2) {
                                var parsed = JSON.parse(body);
                                if(_shapeOk(data && data.action, parsed)) {
                                    out = parsed;
                                } else {
                                    _debug.call(self, 'Bad response shape for ' +
                                        (data && data.action) + ' => ' +
                                        body.substring(0, 80), 'Xtream', true);
                                }
                            }
                        }
                    } catch(e) {
                        _debug.call(self, '_reqAsync parse: ' + e,
                                    'Xtream', true);
                    }
                    if(out === false && s.compression) {
                        _debug.call(self, '_reqAsync ' +
                            (data && data.action) +
                            ' gzip fallito, riprovo senza', 'Xtream', true);
                        s.compression = false;
                        attempt();
                        return;
                    }
                    _debug.call(self, '_reqAsync ' + (data && data.action) +
                        (data && data.category_id ? ' cat=' + data.category_id : '') +
                        ' err=' + err + ' items=' +
                        (out && out.length !== undefined ? out.length : out),
                        'Xtream', true);
                    fin(out);
                });
            } catch(e) {
                _debug.call(self, '_reqAsync req: ' + e, 'Xtream', true);
                fin(false);
            }
        }
        attempt();
    }


    /*
     *  _reqListAsync — variante async di _reqList: la scansione del
     *  body procede a fette via setTimeout cosi' la coda dei task
     *  ES non resta congelata (e i prop-op di altre pagine girano).
     *  cb({ l: array slim, hc: hasCategoryFields } | false).
     *  Il dedup inflight di _reqAsync non si applica: qui la forma
     *  della risposta dipende da itemFn del chiamante.
     */
    function _reqListAsync(data, itemFn, cb) {

        var self = this;
        if(!self.credentials().username || !self.credentials().password) {
            cb(false);
            return;
        }

        var url = self.playerUrl() +
                  "?username=" + encodeURIComponent(self.credentials().username) +
                  "&password=" + encodeURIComponent(self.credentials().password);

        if (data === Object(data) && Object.prototype.toString.call(data) !== '[object Array]') {
            for(var k in data)
                url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(data[k]);
        }

        var s = { method: "GET",
                  debug: self.options().debug,
                  compression: true,
                  connectTimeout: 5000,
                  readTimeout: 60000,
                  headers: { 'User-Agent' : self.userAgent() }
                 };

        // dedup in-flight: due fetch concorrenti dello stesso
        // catalogo raddoppierebbero il picco di memoria. Mappa
        // separata da _inflight: qui la cb riceve {l,hc}, non il
        // parsed grezzo
        var fin;
        if(_inflightL[url]) { _inflightL[url].push(cb); return; }
        _inflightL[url] = [cb];
        fin = function(out) {
            var list = _inflightL[url] || [];
            delete _inflightL[url];
            for(var i = 0; i < list.length; i++)
                try { list[i](out); } catch(e0) {
                    _debug.call(self, '_reqListAsync cb: ' + e0,
                                'Xtream', true);
                }
        };

        function attempt() {
            try {
                http.request(url, s, function(err, res) {
                    var body = false;
                    try {
                        if(!err && res) {
                            var t = res.toString();
                            if(t && t.length >= 2) body = t;
                        }
                    } catch(e) {
                        _debug.call(self, '_reqListAsync read: ' + e,
                                    'Xtream', true);
                    }
                    if(body === false && s.compression) {
                        _debug.call(self, '_reqListAsync ' +
                            (data && data.action) +
                            ' gzip fallito, riprovo senza', 'Xtream', true);
                        s.compression = false;
                        attempt();
                        return;
                    }
                    if(body === false) { fin(false); return; }

                    var scan;
                    try { scan = _jsonScan(body); } catch(e2) { scan = null; }
                    if(!scan) {
                        // payload non-array: shape check classico
                        var parsed = false;
                        try { parsed = JSON.parse(body); } catch(e3) {}
                        fin(parsed && _shapeOk(data && data.action, parsed) ?
                            { l: parsed, hc: true } : false);
                        return;
                    }

                    var out = [], hc = false, first = true, bad = false;
                    (function step() {
                        var cnt = 0;
                        for(;;) {
                            var raw;
                            try { raw = scan.next(); }
                            catch(e4) { raw = undefined; bad = true; }
                            if(raw === undefined) break;
                            if(first) {
                                first = false;
                                if(!_shapeOk(data && data.action, [raw])) {
                                    bad = true;
                                    break;
                                }
                            }
                            if(!hc && raw &&
                               (raw.category_id != null ||
                                raw.category_ids != null))
                                hc = true;
                            if(typeof raw === 'object') {
                                try { out.push(itemFn(self, raw)); }
                                catch(e5) {}
                            }
                            if(++cnt >= 4000) { setTimeout(step, 0); return; }
                        }
                        _debug.call(self, '_reqListAsync ' +
                            (data && data.action) +
                            (data && data.category_id ?
                                ' cat=' + data.category_id : '') +
                            ' err=' + err + ' items=' +
                            (bad ? 'bad-shape' : out.length), 'Xtream', true);
                        fin(bad ? false : { l: out, hc: hc });
                    })();
                });
            } catch(e) {
                _debug.call(self, '_reqListAsync req: ' + e, 'Xtream', true);
                fin(false);
            }
        }
        attempt();
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
     *  checkLogin async — stessa logica ma via _reqAsync: la
     *  home del plugin si apre subito e decide su callback.
     *  cb({status, error})
     */
    Xtream.prototype.checkLoginAsync = function (cb) {

        if(!this.credentials().username || !this.credentials().password) {
            cb({status : false, error: "No credentials set"});
            return;
        }

        var self = this;
        var res = this._cachePeek('_info', 600);
        if(res && res.user_info) {
            if(String(res.user_info.auth) == '0')
                cb({status : false, error: "Authentication failed (auth=0)"});
            else
                cb({status : true, error: ''});
            return;
        }

        _reqAsync.call(this, {}, function(r) {
            if(r && r.user_info) {
                try { self._cachePut('_info', r); } catch(e) {}
                if(String(r.user_info.auth) == '0')
                    cb({status : false, error: "Authentication failed (auth=0)"});
                else
                    cb({status : true, error: ''});
            } else {
                cb({status : false,
                    error: "Something went wrong, maybe wrong credentials or expired"});
            }
        });
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


    Xtream.prototype.getInfoAsync = function (action, cb) {

        var self = this;
        _reqAsync.call(this, {}, function(res) {
            if(!res) { cb(false); return; }
            switch (action) {
                case "user":   cb(res.user_info);   return;
                case "server": cb(res.server_info); return;
                default:       cb(res);
            }
        });
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

        // SOLO peek di cache: _liveItem la chiama per OGNI canale
        // e una getInfo() qui farebbe un _req HTTP sincrono sul
        // thread ES a TTL scaduto — freeze in pieno parsing del
        // catalogo. _info viene scaldata da checkLoginAsync allo
        // start; a cache fredda si usa il default m3u8 (standard
        // Xtream — 'ts' serve solo ai pannelli senza m3u8).
        var res = this._cachePeek('_info', 600);
        var user = res && res.user_info;
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
     *  _liveItem — mapping condiviso sync/async di un canale live.
     *  { id, cat_id, title, icon, epgid, source:{ url } }
     */
    function _liveItem(xt, r) {
        return { id: r.stream_id ?  r.stream_id :  0,
                 cat_id: r.category_id ?  r.category_id :  '0',
                 title: r.name  ? r.name :  'Unknown',
                 icon: (r.stream_icon && r.stream_icon != '') ? r.stream_icon : Plugin.path + 'images/livetv.png',
                 epgid: r.epg_channel_id ? r.epg_channel_id : '',
                 archive: r.tv_archive == 1 || r.tv_archive === true,
                 source:{url: xt.baseUrl().playerApi + "/live/" + xt.credentials().username + "/" + xt.credentials().password + "/" + r.stream_id + "." + xt.liveExtension() }
               };
    }


    /*
     *  Live Streams
     *  Returns an array of live streams. Each element of the array is an object.
     */
    Xtream.prototype.getLiveStreams = function() {

        var self = this;
        var res = this._cached('_live', 300, function() {
            var r = _reqList.call(self, { action: "get_live_streams" },
                                  _liveItem);
            return r ? r.l : false;
        });
        if(this.options().debug)
            _debug.call(this, 'items=' + (res ? res.length : res),
                        "Xtream:getLiveStreams");
        return res || [];

    };


    Xtream.prototype.getLiveStreamsAsync = function(cb) {

        var self = this;
        var w = this._cachePeek('_live', 300);
        if(w) { cb(w); return; }
        _reqListAsync.call(this, { action: "get_live_streams" },
                          _liveItem, function(r) {
            if(!r) { cb(false); return; }
            self._cachePut('_live', r.l);
            cb(r.l);
        });
    };


    Xtream.prototype.getLiveStreamsByCategoryIdAsync = function(id, cb) {

        var self = this;
        // catalogo intero gia' in cache -> filtro locale, niente rete
        var w = this._cachePeek('_live', 300);
        if(w) { cb(_catFilter(w, true, id)); return; }
        _reqListAsync.call(this, { action: "get_live_streams",
                                   category_id: id }, _liveItem,
                           function(r) {
            if(!r) {
                // pannello che rigetta category_id -> catalogo
                // intero + filtro locale (messo in cache: le
                // categorie successive riusano la stessa lista)
                _reqListAsync.call(self, { action: "get_live_streams" },
                                   _liveItem, function(r2) {
                    if(!r2) { cb(false); return; }
                    self._cachePut('_live', r2.l);
                    cb(_catFilter(r2.l, r2.hc, id));
                });
                return;
            }
            cb(_catFilter(r.l, r.hc, id));
        });
    };


    Xtream.prototype.getLiveCategoriesAsync = function(cb) {

        var self = this;
        _reqAsync.call(this, { action: "get_live_categories" },
                       function(res) {
            if(!res) { cb(false); return; }
            var cats = [];
            for(var i in res)
                cats.push({ id: res[i].category_id ?  res[i].category_id :  '0',
                            title: res[i].category_name && res[i].category_name != 'undefined' ? res[i].category_name :  'Unknown',
                            icon: Plugin.path + 'images/livetv.png'
                          });
            cb(cats);
        });
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

        // cat_id resta sugli item: la lista slim ora e' condivisa
        // via cache e gli altri filtri (gruppi nascosti, _catMatch)
        // lo leggono
        if(res) {

           for(var i in res) {

              if( String(id) == '0' ) {
                 if( res[i].cat_id == '' || res[i].cat_id == '0' ){
                    streams.push(res[i]);
                 }
              }

              else {
                if( res[i].cat_id == id ){

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


    Xtream.prototype.getVodCategoriesAsync = function(cb) {

        _reqAsync.call(this, { action: "get_vod_categories" },
                       function(res) {
            if(!res) { cb(false); return; }
            var cats = [];
            for(var i in res)
                cats.push({ id: res[i].category_id ?  res[i].category_id :  '0',
                            title: res[i].category_name  ? res[i].category_name :  'Unknown',
                            icon: Plugin.path + 'images/vod.png'
                          });
            cb(cats);
        });
    };


    /*
     *  Vod Streams
     *  Returns an array of vod streams.
     *  [{ id, cat_id, title, icon, rating, year, source:{ url } }]
     */
    /*
     *  _vodItem — mapper record grezzo -> item slim, usato da
     *  _reqList/_reqListAsync (scan incrementale: il record grezzo
     *  non resta in memoria dopo il mapping).
     */
    function _vodItem(xt, r) {

        var ext = xt.vodExtension(r.container_extension);
        var cid = r.category_id != null ? r.category_id :
                  (r.category_ids != null ? r.category_ids : '0');

        return { id: r.stream_id ?  r.stream_id :  0,
                 cat_id: cid,
                 title: r.name ? r.name :  'Unknown',
                 icon: (r.stream_icon && r.stream_icon != '') ? r.stream_icon : Plugin.path + 'images/vod.png',
                 rating: r.rating_5based ? r.rating_5based : (r.rating ? r.rating : ''),
                 added: parseInt(r.added, 10) || 0,
                 source:{url:    xt.baseUrl().playerApi + "/movie/" + xt.credentials().username + "/" + xt.credentials().password + "/" + r.stream_id + "." + ext}
               };
    }


    Xtream.prototype.getVodStreams = function() {

        var self = this;
        var res = this._cached('_vod', 300, function() {
            var r = _reqList.call(self, { action: "get_vod_streams" },
                                  _vodItem);
            return r ? r.l : false;
        });
        if(this.options().debug)
            _debug.call(this, 'items=' + (res ? res.length : res),
                        "Xtream:getVodStreams");

        return res || [];

    };


    /*
     *  Vod Streams by category id — fetch lato server con
     *  category_id (il catalogo intero puo' pesare decine di MB);
     *  il refilter _catMatch copre i pannelli che ignorano il
     *  parametro.
     */
    /*
     *  _catFilter — refilter client-side dopo un fetch
     *  per-categoria. Se gli item non espongono nessun campo
     *  categoria il server ha gia' filtrato lui (o il pannello non
     *  la fornisce): rifiltrare svuoterebbe la lista.
     */
    function _catFilter(built, hc, id) {

        if(!hc) return built;
        var streams = [];
        for(var j = 0; j < built.length; j++)
            if(_catMatch(built[j].cat_id, id)) streams.push(built[j]);
        return streams;
    }


    Xtream.prototype.getVodStreamsByCategoryId = function(id) {

        var self = this;
        var res = this._cached('_vod:' + id, 300, function() {
            return _reqList.call(self, { action: "get_vod_streams",
                                         category_id: id }, _vodItem);
        });

        // il pannello rigetta category_id -> fetch intero +
        // filtro locale (stesso risultato, piu' traffico)
        if(!res)
            res = _reqList.call(this, { action: "get_vod_streams" },
                                _vodItem);

        return res ? _catFilter(res.l, res.hc, id) : [];

    };


    Xtream.prototype.getVodStreamsAsync = function(cb) {

        var self = this;
        var w = this._cachePeek('_vod', 300);
        if(w) { cb(w); return; }
        _reqListAsync.call(this, { action: "get_vod_streams" },
                          _vodItem, function(r) {
            if(!r) { cb(false); return; }
            self._cachePut('_vod', r.l);
            cb(r.l);
        });
    };


    Xtream.prototype.getVodStreamsByCategoryIdAsync = function(id, cb) {

        var self = this;
        var w = this._cachePeek('_vod', 300);
        if(w) { cb(_catFilter(w, true, id)); return; }
        _reqListAsync.call(this, { action: "get_vod_streams",
                                   category_id: id }, _vodItem,
                           function(r) {
            if(!r) {
                // pannello che rigetta category_id -> catalogo
                // intero + filtro locale (messo in cache: le
                // categorie successive riusano la stessa lista)
                _reqListAsync.call(self, { action: "get_vod_streams" },
                                   _vodItem, function(r2) {
                    if(!r2) { cb(false); return; }
                    self._cachePut('_vod', r2.l);
                    cb(_catFilter(r2.l, r2.hc, id));
                });
                return;
            }
            cb(_catFilter(r.l, r.hc, id));
        });
    };


    /*
     *  Vod Info
     *  Returns a showtime video object
     */
    /*
     *  _vodInfoBuild — mapper res JSON -> dettaglio film, condiviso
     *  dai path sync e async.
     */
    function _vodInfoBuild(xt, id, res) {

        if(!res || !res.movie_data)
            return false;

        var cn = res.info && res.info.video && res.info.video.codec_name ? res.info.video.codec_name : '';
        var cw = res.info && res.info.video && res.info.video.coded_width ? res.info.video.coded_width : (res.info && res.info.video && res.info.video.width ? res.info.video.width : '');
        var ch = res.info && res.info.video && res.info.video.coded_height ? res.info.video.coded_height : (res.info && res.info.video && res.info.video.height ? res.info.video.height : '');
        var au = res.info && res.info.audio && res.info.audio.codec_name ? res.info.audio.codec_name : (res.info && res.info.audio ? res.info.audio : '');
        var cast = res.info && res.info.cast ? res.info.cast: '';
        var dir = res.info && res.info.director ? res.info.director: '';
        var plot = res.info && res.info.plot ? res.info.plot: '';

        var ext = xt.vodExtension(res.movie_data.container_extension);

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
                  source:{url:    xt.baseUrl().playerApi + "/movie/" + xt.credentials().username + "/" + xt.credentials().password + "/" + id+ "." + ext}
         };
    }

    Xtream.prototype.getVodInfo = function(id) {

        var res = _req.call(this, { action: "get_vod_info", vod_id: id});
        _debug.call(this, JSON.stringify(res), "Xtream:getVodInfo");

        return _vodInfoBuild(this, id, res);
    };

    Xtream.prototype.getVodInfoAsync = function(id, cb) {

        var self = this;
        var hit = self._cachePeek('_vodi:' + id, 300);
        if(hit !== undefined) { cb(hit); return; }
        _reqAsync.call(this, { action: "get_vod_info", vod_id: id },
                       function(res) {
            if(!res) { cb(false); return; }
            var v = _vodInfoBuild(self, id, res);
            self._cachePut('_vodi:' + id, v);
            cb(v);
        });
    };


    /*
     *  _seriesItem — mapper record grezzo -> item slim, usato da
     *  _reqList/_reqListAsync.
     */
    function _seriesItem(xt, r) {

        var cast = r.cast ? r.cast : '';
        var dir = r.director ? r.director: '';
        var plot = r.plot ? r.plot: '';
        var cid = r.category_id != null ? r.category_id :
                  (r.category_ids != null ? r.category_ids : '0');

        return { id: r.series_id ?  r.series_id :  0,
                 cat_id: cid,
                 title: r.name  ? r.name :  'Unknown',
                 icon: r.cover && r.cover != '' ? r.cover : Plugin.path + "images/series.png",
                 tagline: r.episode_run_time ? r.episode_run_time : "?",
                 genre: r.genre ? r.genre : 'unknown',
                 description: (cast ? "Cast: " + cast + " - " : '') + (dir ? dir + "\n" : '') + plot ,
                 rating: r.rating ? r.rating : '',
                 added: parseInt(r.last_modified, 10) || parseInt(r.added, 10) || 0,
                 year: r.releaseDate ? r.releaseDate : '',
                 source:{url:    xt.baseUrl().playerApi + "/series/" + xt.credentials().username + "/" + xt.credentials().password + "/" + r.series_id+ ".mp4"}
               };
    }




    Xtream.prototype.getSeries = function() {

        var self = this;
        var res = this._cached('_series', 300, function() {
            var r = _reqList.call(self, { action: "get_series" },
                                  _seriesItem);
            return r ? r.l : false;
        });
        if(this.options().debug)
            _debug.call(this, 'items=' + (res ? res.length : res),
                        "Xtream:getSeriesStreams");
        return res || [];

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


    Xtream.prototype.getSeriesCategoriesAsync = function(cb) {

        _reqAsync.call(this, { action: "get_series_categories" },
                       function(res) {
            if(!res) { cb(false); return; }
            var cats = [];
            for(var i in res)
                cats.push({ id: res[i].category_id ?  res[i].category_id :  '0',
                            title: res[i].category_name  ? res[i].category_name :  'Unknown',
                            icon: Plugin.path + 'images/series.png'
                          });
            cb(cats);
        });
    };


    /*
     *  Series by category id
     */
    Xtream.prototype.getSeriesByCategoryId = function(id) {

        var self = this;
        var res = this._cached('_series:' + id, 300, function() {
            return _reqList.call(self, { action: "get_series",
                                         category_id: id }, _seriesItem);
        });

        if(!res)
            res = _reqList.call(this, { action: "get_series" },
                                _seriesItem);

        return res ? _catFilter(res.l, res.hc, id) : [];

    };


    Xtream.prototype.getSeriesAsync = function(cb) {

        var self = this;
        var w = this._cachePeek('_series', 300);
        if(w) { cb(w); return; }
        _reqListAsync.call(this, { action: "get_series" },
                          _seriesItem, function(r) {
            if(!r) { cb(false); return; }
            self._cachePut('_series', r.l);
            cb(r.l);
        });
    };


    Xtream.prototype.getSeriesByCategoryIdAsync = function(id, cb) {

        var self = this;
        var w = this._cachePeek('_series', 300);
        if(w) { cb(_catFilter(w, true, id)); return; }
        _reqListAsync.call(this, { action: "get_series",
                                   category_id: id }, _seriesItem,
                           function(r) {
            if(!r) {
                // pannello che rigetta category_id -> catalogo intero
                // (messo in cache: le categorie successive riusano
                // la stessa lista invece di rifare il fetch)
                _reqListAsync.call(self, { action: "get_series" },
                                   _seriesItem, function(r2) {
                    if(!r2) { cb(false); return; }
                    self._cachePut('_series', r2.l);
                    cb(_catFilter(r2.l, r2.hc, id));
                });
                return;
            }
            cb(_catFilter(r.l, r.hc, id));
        });
    };


    /*
     *  Series Info
     *  Returns an array of episodes (all seasons flattened).
     */
    /*
     *  _seriesInfoBuild — mapper res JSON -> lista episodi,
     *  condiviso dai path sync e async.
     */
    function _seriesInfoBuild(xt, res) {

        var series = [];

        if(res && res.episodes){
            for (var i in res.episodes) {
                for(var j in res.episodes[i] ){

                    var ep = res.episodes[i][j];

                    var cn = ep.info && ep.info.video && ep.info.video.codec_name ? ep.info.video.codec_name : '';
                    var cw = ep.info && ep.info.video && ep.info.video.coded_width ? ep.info.video.coded_width : '';
                    var ch = ep.info && ep.info.video && ep.info.video.coded_height ? ep.info.video.coded_height : '';
                    var au = ep.info && ep.info.audio && ep.info.audio.codec_name ? ep.info.audio.codec_name : '';

                    var ext = xt.vodExtension(ep.container_extension);

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
                                  source:{url:    xt.baseUrl().playerApi + "/series/" + xt.credentials().username + "/" + xt.credentials().password + "/" + ep.id+ "." + ext}
                                 });
                }
            }
        }

         return series;
    }


    Xtream.prototype.getSeriesInfo = function(id) {

        var res = _req.call(this, { action: "get_series_info", series_id: id});
        _debug.call(this, JSON.stringify(res), "Xtream:getSeriesInfo");

        return _seriesInfoBuild(this, res);
    };


    Xtream.prototype.getSeriesInfoAsync = function(id, cb) {

        var self = this;
        var hit = self._cachePeek('_seriesi:' + id, 300);
        if(hit !== undefined) { cb(hit); return; }
        _reqAsync.call(this, { action: "get_series_info",
                               series_id: id }, function(res) {
            if(!res) { cb(false); return; }
            var v = _seriesInfoBuild(self, res);
            self._cachePut('_seriesi:' + id, v);
            cb(v);
        });
    };


    return Xtream;

})();


module.exports = Xtream;
