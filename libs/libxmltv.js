/**
 *  libxmltv is a module for ecmascript — XMLTV guide parsing
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

var xml = require('movian/xml');


var XmlTv = (function () {

    var _OPTIONS = { debug : false };

    /* construct */
    function XmlTv(options) {

        options = (options === Object(options) &&
                   Object.prototype.toString.call(options) !== '[object Array]') ? options : {};

        this.options = function () {
            return { debug : options.debug ? true : false };
        };

        // channelId -> [ events sorted by start ]
        this.byId = {};
        // normalized display-name / id -> channelId
        this.alias = {};
        // channelId -> { id, names[], icon }
        this.channels = {};
        this.fetchedAt = 0;
        // match() memo: i canali senza EPG farebbero uno scan
        // lineare di alias a OGNI chiamata (righe x alias)
        this._matchCache = {};
    }


    function _debug(message, tag, force) {
        if(typeof(force) == 'undefined' || force !== true) force = false;
        if(this.options().debug || force ) console.log(message, tag);
    }


    /*
     *  normalizeName — matching key for "Rai 1 HD" vs XMLTV "Rai1":
     *  lowercase, drop parenthesised suffixes, drop non-alnum, drop
     *  trailing quality tokens (hd, sd, uhd, 4k, plus, it, ita).
     */
    function normalizeName(s) {

        if(!s) return '';

        s = String(s);
        var p = s.indexOf('(');
        if(p >= 0) s = s.substring(0, p);

        s = s.toLowerCase();

        // cheap accent folding for the common italian vowels
        s = s.replace(/[àáâä]/g, 'a').replace(/[èéêë]/g, 'e')
             .replace(/[ìíîï]/g, 'i').replace(/[òóôö]/g, 'o')
             .replace(/[ùúûü]/g, 'u');

        s = s.replace(/[^a-z0-9]/g, '');

        var again = true;
        while(again) {
            again = false;
            var sufs = ['uhd', '4k', 'hd', 'sd', 'plus', 'ita', 'it'];
            for(var i in sufs) {
                var suf = sufs[i];
                if(s.length > suf.length + 2 && s.substring(s.length - suf.length) == suf) {
                    s = s.substring(0, s.length - suf.length);
                    again = true;
                }
            }
        }

        return s;
    }


    /*
     *  xmltvTime — "20060102150405 +0100" / "+02:00" / bare (UTC) -> unix secs
     */
    function xmltvTime(s) {

        if(!s) return 0;
        s = String(s).replace(/^\s+|\s+$/g, '');
        if(s.length < 14) return 0;

        var base = s.substring(0, 14);
        var rest = s.substring(14).replace(/\s/g, '');

        var y  = parseInt(base.substring(0, 4), 10);
        var mo = parseInt(base.substring(4, 6), 10) - 1;
        var d  = parseInt(base.substring(6, 8), 10);
        var h  = parseInt(base.substring(8, 10), 10);
        var mi = parseInt(base.substring(10, 12), 10);
        var se = parseInt(base.substring(12, 14), 10);

        var ms = Date.UTC(y, mo, d, h, mi, se);

        if(rest) {
            var m = rest.match(/^([+-])(\d{2}):?(\d{2})$/);
            if(m) {
                var off = (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 60000;
                ms -= (m[1] == '+' ? off : -off);
            }
        }

        return Math.floor(ms / 1000);
    }


    /*
     *  text of an element: proxy fields expose strValue via toString/
     *  valueOf; empty elements yield "<XML/>", filter that out.
     */
    function _text(v) {
        if(v === undefined || v === null) return '';
        var s = v.toString();
        return (s == '<XML/>' || s == '[object Object]') ? '' : s;
    }


    /*
     *  pick — first non-empty value among possibly repeated nodes.
     */
    function _pick(node, name) {

        var v = _text(node[name]);
        if(v) return v;

        var list = node.filterNodes(name);
        for(var i = 0; i < list.length; i++) {
            v = _text(list[i]);
            if(v) return v;
        }
        return '';
    }


    /*
     *  parse — parse a full XMLTV document string into the guide.
     *  keepFn(normName) optional filter on normalized names to bound
     *  memory on huge feeds. Returns true on success.
     */
    XmlTv.prototype.parse = function(xmlstring, keepFn) {

        if(!xmlstring) return false;

        var doc;
        try {
            doc = xml.parse(xmlstring);
        } catch(e) {
            _debug.call(this, e.toString(), 'XmlTv:parse', true);
            return false;
        }

        var tv = doc.tv;
        if(!tv) return false;

        var byId = {};
        var alias = {};
        var channels = {};

        // pass 1 — channels: id -> names, alias normalized name -> id
        var chans = tv.filterNodes('channel');
        for(var i = 0; i < chans.length; i++) {

            var ch = chans[i];
            var id = _text(ch['@id']);
            if(!id) continue;

            var names = [];
            var dnames = ch.filterNodes('display-name');
            for(var j = 0; j < dnames.length; j++) {
                var nm = _text(dnames[j]);
                if(nm) names.push(nm);
            }

            var icon = '';
            var icons = ch.filterNodes('icon');
            for(var j = 0; j < icons.length; j++) {
                var src = _text(icons[j]['@src']);
                if(src) { icon = src; break; }
            }

            var match = (keepFn === undefined || keepFn === null);
            if(!match) {
                if(keepFn(normalizeName(id))) {
                    match = true;
                } else {
                    for(var j = 0; j < names.length; j++) {
                        if(keepFn(normalizeName(names[j]))) { match = true; break; }
                    }
                }
            }
            if(!match) continue;

            channels[id] = { id: id, names: names, icon: icon };
            alias[normalizeName(id)] = id;
            for(var j = 0; j < names.length; j++)
                alias[normalizeName(names[j])] = id;

            if(!byId[id]) byId[id] = [];
        }

        // pass 2 — programmes
        var progs = tv.filterNodes('programme');
        for(var i = 0; i < progs.length; i++) {

            var pr = progs[i];
            var cid = _text(pr['@channel']);

            if(!(cid in byId)) continue;

            var start = xmltvTime(_text(pr['@start']));
            var stop  = xmltvTime(_text(pr['@stop']));
            if(!start) continue;
            if(!stop || stop <= start) stop = start + 3600;

            var picon = '';
            var picons = pr.filterNodes('icon');
            for(var k = 0; k < picons.length; k++) {
                var psrc = _text(picons[k]['@src']);
                if(psrc) { picon = psrc; break; }
            }

            byId[cid].push({
                title: _pick(pr, 'title'),
                desc:  _pick(pr, 'desc'),
                category: _pick(pr, 'category'),
                icon: picon,
                start: start,
                stop: stop
            });
        }

        for(var id in byId)
            byId[id].sort(function(a, b) { return a.start - b.start; });

        this.byId = byId;
        this.alias = alias;
        this.channels = channels;
        this.fetchedAt = Math.floor(Date.now() / 1000);
        this._matchCache = {};

        _debug.call(this, 'XmlTv: parsed ' + chans.length + ' channels, ' +
                    progs.length + ' programmes', 'XmlTv:parse');

        return true;
    };


    /*
     *  match — resolve a stream name or epg_channel_id to a guide id.
     *  Exact id first, then normalized name, then longest alias that
     *  is a prefix/suffix of the normalized name. Risultati memoizzati:
     *  un miss (canale senza EPG) costerebbe O(#alias) a ogni chiamata.
     */
    XmlTv.prototype.match = function(name) {

        if(!name) return '';
        name = String(name);

        var c = this._matchCache[name];
        if(c !== undefined) return c;

        var r;
        if(name in this.byId) {
            r = name;
        } else {
            var n = normalizeName(name);
            if(n in this.alias) {
                r = this.alias[n];
            } else {
                var best = '';
                for(var a in this.alias) {
                    if(a.length < 4 || a.length <= best.length) continue;
                    if(n.indexOf(a) === 0 ||
                       n.lastIndexOf(a) === n.length - a.length)
                        best = a;
                }
                r = best ? this.alias[best] : '';
            }
        }

        this._matchCache[name] = r;
        return r;
    };


    /*
     *  eventsFor — all events for channel (id or name) overlapping [from, to)
     */
    XmlTv.prototype.eventsFor = function(name, from, to) {

        var id = this.match(name);
        if(!id) return [];

        var evs = this.byId[id] || [];
        var out = [];

        for(var i = 0; i < evs.length; i++) {
            var e = evs[i];
            if(e.stop <= from) continue;
            if(e.start >= to) break;
            out.push(e);
        }

        return out;
    };


    /*
     *  nowNext — {current, next} events at time t (unix secs) or now.
     */
    XmlTv.prototype.nowNext = function(name, t) {

        if(!t) t = Math.floor(Date.now() / 1000);

        var evs = this.eventsFor(name, 0, t + 86400 * 7);

        for(var i = 0; i < evs.length; i++) {
            var e = evs[i];
            if(e.start <= t && e.stop > t)
                return { current: e, next: i + 1 < evs.length ? evs[i + 1] : null };
            if(e.start > t)
                return { current: null, next: e };
        }

        return { current: null, next: null };
    };


    /*
     *  preslice — return a reduced XMLTV document: every <channel>
     *  element is kept, but only the <programme> elements whose
     *  channel id is wanted (raw id in idSet, or keepFn on the
     *  normalized id). Huge provider feeds ship programmes for
     *  thousands of channels; slicing before xml.parse bounds the
     *  native DOM build to our channels only.
     */
    XmlTv.prototype.preslice = function(xmlstring, keepFn, idSet) {

        if(!keepFn && !idSet) return xmlstring;

        var head = xmlstring.indexOf('<programme');
        if(head == -1) return xmlstring;

        var tail = xmlstring.lastIndexOf('</tv>');
        if(tail == -1) tail = xmlstring.length;

        // Il keep deve specchiare parse(): un canale e' "wanted" se
        // keepFn matcha l'id OPPURE uno dei suoi display-name.
        // Scansiono i <channel> dell'header (sempre prima dei
        // <programme>) — senza questo passo i programmi di canali
        // risolti via display-name verrebbero scartati e l'EPG su
        // quei canali risulterebbe vuoto.
        var keepIds = {};
        var hb = xmlstring.substring(0, head);
        var cp = 0;
        for(;;) {
            var cs = hb.indexOf('<channel', cp);
            if(cs == -1) break;
            var cend = hb.indexOf('</channel>', cs);
            if(cend == -1) break;
            var cblk = hb.substring(cs, cend);
            cp = cend + 10;

            var ii = cblk.indexOf('id="');
            if(ii == -1) continue;
            var ie = cblk.indexOf('"', ii + 4);
            if(ie == -1) continue;
            var chanId = cblk.substring(ii + 4, ie);

            var want = (idSet && idSet[chanId] === true) ||
                       (keepFn && keepFn(normalizeName(chanId)));
            if(!want && keepFn) {
                var dp = 0;
                for(;;) {
                    var ds = cblk.indexOf('<display-name', dp);
                    if(ds == -1) break;
                    var gt = cblk.indexOf('>', ds);
                    var lt = cblk.indexOf('</display-name>', ds);
                    if(gt == -1 || lt == -1 || lt < gt) break;
                    if(keepFn(normalizeName(
                            cblk.substring(gt + 1, lt)))) {
                        want = true;
                        break;
                    }
                    dp = lt + 15;
                }
            }
            if(want) keepIds[chanId] = true;
        }

        var parts = [hb];
        var p = head, kept = 0, total = 0;

        for(;;) {
            var n = xmlstring.indexOf('<programme', p);
            if(n == -1 || n >= tail) break;

            var be = xmlstring.indexOf('</programme>', n);
            if(be == -1) break;
            be += 12;

            var block = xmlstring.substring(n, be);
            total++;

            var keep = false;
            var ci = block.indexOf('channel="');
            if(ci != -1) {
                var ce = block.indexOf('"', ci + 9);
                if(ce != -1) {
                    var cid = block.substring(ci + 9, ce);
                    keep = keepIds[cid] === true ||
                           (idSet && idSet[cid] === true) ||
                           (keepFn && keepFn(normalizeName(cid)));
                }
            }
            if(keep) {
                parts.push(block);
                kept++;
            }
            p = be;
        }

        _debug.call(this, 'XmlTv: preslice kept ' + kept + '/' + total +
                    ' programmes', 'XmlTv:preslice');

        parts.push(xmlstring.substring(tail));
        return parts.join('');
    };


    /*
     *  scan — parser XMLTV a scansione stringhe: costruisce
     *  channels/alias/byId senza xml.parse (DOM). Su feed da
     *  decine di MB il DOM costa centinaia di MB di RAM e minuti
     *  di CPU; qui ogni blocco e' ispezionato con indexOf.
     *  wantFn(normAlias)/idSet filtrano i canali come in preslice.
     */
    function _sattr(s, name) {
        var q = name + '="';
        var i = s.indexOf(q);
        if(i == -1) return '';
        var b = i + q.length;
        var e = s.indexOf('"', b);
        return e == -1 ? '' : s.substring(b, e);
    }

    function _selem(s, name) {
        var i = s.indexOf('<' + name);
        if(i == -1) return '';
        var gt = s.indexOf('>', i);
        if(gt == -1) return '';
        var lt = s.indexOf('</' + name + '>', gt);
        if(lt == -1) return '';
        return s.substring(gt + 1, lt);
    }

    function _sent(s) {
        if(!s || s.indexOf('&') == -1) return s;
        return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                .replace(/&#(\d+);/g, function(m, d) {
                    return String.fromCharCode(parseInt(d, 10));
                }).replace(/&amp;/g, '&');
    }

    XmlTv.prototype.scan = function(xmlstring, wantFn, idSet) {

        if(!xmlstring) return false;

        var head = xmlstring.indexOf('<programme');
        if(head == -1) head = xmlstring.length;
        var tail = xmlstring.lastIndexOf('</tv>');
        if(tail == -1 || tail < head) tail = xmlstring.length;

        var channels = {}, alias = {}, byId = {}, keepIds = {};

        // pass 1 — <channel> nell'header
        var hb = head == xmlstring.length ? xmlstring :
                 xmlstring.substring(0, head);
        var cp = 0;
        for(;;) {
            var cs = hb.indexOf('<channel', cp);
            if(cs == -1) break;
            var cend = hb.indexOf('</channel>', cs);
            if(cend == -1) break;
            var cblk = hb.substring(cs, cend);
            cp = cend + 10;

            var cid = _sattr(cblk, 'id');
            if(!cid) continue;

            var names = [];
            var want = (idSet && idSet[cid] === true) ||
                       (wantFn && wantFn(normalizeName(cid)));

            var icon = '';
            var dp = 0;
            for(;;) {
                var ds = cblk.indexOf('<display-name', dp);
                if(ds == -1) break;
                var gt2 = cblk.indexOf('>', ds);
                var lt2 = cblk.indexOf('</display-name>', ds);
                if(gt2 == -1 || lt2 == -1 || lt2 < gt2) break;
                var dn = _sent(cblk.substring(gt2 + 1, lt2));
                names.push(dn);
                if(!want && wantFn && wantFn(normalizeName(dn)))
                    want = true;
                dp = lt2 + 15;
            }

            var is = cblk.indexOf('<icon');
            if(is != -1)
                icon = _sattr(cblk.substring(is), 'src') ||
                       _sattr(cblk.substring(is), 'url');

            if(!want) continue;

            channels[cid] = { id: cid, names: names, icon: icon };
            var nc = normalizeName(cid);
            if(nc) alias[nc] = cid;
            for(var j = 0; j < names.length; j++) {
                var nd = normalizeName(names[j]);
                if(nd) alias[nd] = cid;
            }
            byId[cid] = [];
            keepIds[cid] = true;
        }

        // pass 2 — <programme>
        // Finestra: palinsesto usa -12h..+48h — gli eventi fuori
        // finestra si scartano a monte (feed multi-day: e' la meta'
        // abbondante della dimensione, RAM e cache JSON).
        var now = Math.floor(Date.now() / 1000);
        var winLo = now - 12 * 3600, winHi = now + 48 * 3600;

        var p = head, nprog = 0;
        for(;;) {
            var n = xmlstring.indexOf('<programme', p);
            if(n == -1 || n >= tail) break;
            var gt = xmlstring.indexOf('>', n);
            if(gt == -1 || gt >= tail) break;
            var be = xmlstring.indexOf('</programme>', gt);
            if(be == -1) break;

            var attrs = xmlstring.substring(n, gt + 1);
            p = be + 12;

            var pcid = _sattr(attrs, 'channel');
            if(!keepIds[pcid]) continue;

            var start = xmltvTime(_sattr(attrs, 'start'));
            if(!start) continue;
            var stop = xmltvTime(_sattr(attrs, 'stop'));
            if(!stop || stop <= start) stop = start + 3600;

            if(stop < winLo || start > winHi) continue;

            var block = xmlstring.substring(gt + 1, be);

            var picon = '';
            var pi = block.indexOf('<icon');
            if(pi != -1)
                picon = _sattr(block.substring(pi), 'url') ||
                        _sattr(block.substring(pi), 'src');

            // desc troncata: la card info ne mostra 2 righe, il
            // testo integrale gonfierebbe la cache JSON su disco
            var dsc = _sent(_selem(block, 'desc'));
            if(dsc.length > 240)
                dsc = dsc.substring(0, 240);

            byId[pcid].push({
                title: _sent(_selem(block, 'title')),
                desc: dsc,
                category: _sent(_selem(block, 'category')),
                icon: picon,
                start: start,
                stop: stop
            });
            nprog++;
        }

        for(var id in byId)
            byId[id].sort(function(a, b) { return a.start - b.start; });

        this.byId = byId;
        this.alias = alias;
        this.channels = channels;
        this.fetchedAt = Math.floor(Date.now() / 1000);
        this._matchCache = {};

        _debug.call(this, 'XmlTv: scan ' + Object.keys(byId).length +
                    ' channels, ' + nprog + ' programmes', 'XmlTv:scan');

        return true;
    };


    /*
     *  keepForNames — build a keepFn set from an array of raw names.
     */
    XmlTv.prototype.keepForNames = function(names) {

        var set = {};
        for(var i = 0; i < names.length; i++)
            set[normalizeName(names[i])] = true;

        return function(n) { return set[n] === true; };
    };


    /*
     *  wantFor — predicato su alias XMLTV normalizzati che replica
     *  match(): wanted se l'alias coincide con un nome voluto O ne
     *  e' prefisso/suffisso (>=4 char). I bucket first4/last4
     *  rendono il test O(1)-ish per candidato invece di O(nomi).
     *  Serve al preslice per non scartare i programme dei canali
     *  che match() risolverebbe in modo fuzzy.
     */
    XmlTv.prototype.wantFor = function(names) {

        var exact = {};
        var pfx = {}, sfx = {};

        for(var i = 0; i < names.length; i++) {
            var n = normalizeName(names[i]);
            if(!n) continue;
            exact[n] = true;
            if(n.length >= 4) {
                var f = n.substring(0, 4), l = n.substring(n.length - 4);
                if(pfx[f]) pfx[f].push(n); else pfx[f] = [n];
                if(sfx[l]) sfx[l].push(n); else sfx[l] = [n];
            }
        }

        return function(a) {

            if(!a) return false;
            if(exact[a]) return true;
            if(a.length < 4) return false;

            var l = pfx[a.substring(0, 4)];
            if(l)
                for(var i = 0; i < l.length; i++)
                    if(l[i].indexOf(a) === 0) return true;

            l = sfx[a.substring(a.length - 4)];
            if(l)
                for(var j = 0; j < l.length; j++) {
                    var n = l[j];
                    if(n.lastIndexOf(a) === n.length - a.length)
                        return true;
                }

            return false;
        };
    };


    XmlTv.prototype.normalizeName = normalizeName;
    XmlTv.prototype.xmltvTime = xmltvTime;


    return XmlTv;

})();


module.exports = XmlTv;
