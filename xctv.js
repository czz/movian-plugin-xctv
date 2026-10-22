/**
 *  XCtv plugin for Movian Media Center
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

var Xtream = require('./libs/libxtream');
var M3U = require('./libs/libm3u');
var Stalker = require('./libs/libstalker');
var XmlTv = require('./libs/libxmltv');
var page = require('movian/page');
var store = require('movian/store');
var service = require('movian/service');
var settings = require('movian/settings');
var prop = require('movian/prop');
var popup = require('native/popup');
var plugin = JSON.parse(Plugin.manifest);

var logo = Plugin.path + plugin.icon;

// tr — traduzione stringhe JS via NLS (Core.getString). I file
// lang/<lang>.lang del plugin vengono caricati dal runtime ad ogni
// cambio lingua; la stringa sorgente e' l'italiano.
function tr(s) {
    if(!s) return s;
    try {
        var t = Core.getString(s);
        return (t && t !== s) ? t : s;
    } catch(e) {
        return s;
    }
}

// Loader universale di Movian: lega currentpage.model.loading (+ il
// testo di model.loadingStatus). page.loading scrive un prop
// "loading" sulla root della pagina — utile su Movian classico, ma
// invisibile con glwview custom in movian-go: si setta anche
// model.loading perche' il loader si veda davvero.
function setLoading(page, on) {
    page.loading = on ? true : false;
    try { page.model.loading = on ? 1 : 0; } catch(e) {}
}

function setPageHeader(page, title) {

    if (page.metadata) {
        page.metadata.title = title;
        page.metadata.logo = logo;
    }

}


/*
 *  Plugin configuration — backed by the settings store
 *  (Settings -> Apps -> XCtv) so credentials survive restarts.
 */
var cfg = {
    server: '',
    username: '',
    password: '',
    epg: true,
    epgUrl: '',
    epgTtlH: 8,
    epgOffsetMin: 0,     // correzione orario EPG in minuti
    epgOnStart: true,    // aggiorna la guida ad ogni avvio
    lastChan: false,     // riparti dall'ultimo canale visto
    debug: false,
    liveExt: 'auto',      // formato stream live: auto|m3u8|ts
    vodExt: 'auto',       // container VOD/episodi: auto|mkv|mp4|avi
    infoSecs: 5,          // durata info card dopo zap (0 = sempre)
    showNums: true,       // numeri canale in guida
    showLogos: true,      // loghi canale in guida
    pin: '',              // PIN controllo genitori
    playName: 'XCtv',     // nome playlist
    sortMode: 'default',  // ordinamento cataloghi: default|name|added|rating
    userAgent: '',        // User-Agent custom ('' = quello di Movian)
    headers: '',          // header HTTP extra, "Nome: valore" per riga (API)
    plType: 'xtream',     // tipo playlist attiva: xtream|m3u|stalker
    gridHours: 4,         // ore visibili nella griglia guida
    panelAlpha: 85,       // opacita' pannelli/OSD (%)
    accent: 'blue',       // colore accento: blue|green|orange|red|violet
    refreshMin: 0,        // refresh automatico playlist (min, 0 = mai)
    recDir: '',           // cartella registrazioni ('' = storage plugin)
    autoplayNext: true    // a fine episodio parte il successivo
};

settings.globalSettings(plugin.id, plugin.title, logo, plugin.synopsis);

var setServer = settings.createString('server', tr('Server (host[:port] o URL)'), cfg.server, function(v) {
    cfg.server = String(v);
});

var setUser = settings.createString('username', tr('Username'), cfg.username, function(v) {
    cfg.username = String(v);
});

var setPass = settings.createString('password', tr('Password'), cfg.password, function(v) {
    cfg.password = String(v);
});

var setName = settings.createString('playName', tr('Nome playlist'), 'XCtv', function(v) {
    cfg.playName = String(v);
});

// Bool settings arrive as boolean true/false on first load (default) and
// as 1/0 from the store afterwards — parseInt(true) is NaN, so test both.
function _bool(v) {
    return v === true || v === 'true' || v === 1 || !!parseInt(v);
}

var setEpg = settings.createBool('epg', tr('Abilita EPG'), true, function(v) {
    cfg.epg = _bool(v);
});

var setEpgUrl = settings.createString('epgUrl', tr('URL XMLTV personalizzato (opzionale)'), '', function(v) {
    cfg.epgUrl = String(v);
});

var setEpgTtl = settings.createInt('epgTtlH', tr('Aggiorna EPG ogni (ore)'), 8, 1, 48, 1, 'h', function(v) {
    cfg.epgTtlH = parseInt(v) || 8;
});

var setEpgOffset = settings.createInt('epgOffsetMin', tr('Correggi orario EPG (minuti)'), 0, -720, 720, 30, 'min', function(v) {
    cfg.epgOffsetMin = parseInt(v) || 0;
});

var setEpgOnStart = settings.createBool('epgOnStart', tr('Aggiorna EPG all\'avvio'), true, function(v) {
    cfg.epgOnStart = _bool(v);
});

var setDebug = settings.createBool('debug', tr('Log di debug'), false, function(v) {
    cfg.debug = _bool(v);
});

settings.createDivider(tr('Riproduzione'));

var setLiveExt = settings.createMultiOpt('liveExt', tr('Formato stream live'),
    [['auto', tr('Automatico'), true], ['m3u8', tr('HLS (m3u8)')], ['ts', tr('MPEG-TS')]],
    function(v) { cfg.liveExt = String(v); });

var setVodExt = settings.createMultiOpt('vodExt', tr('Formato film/episodi'),
    [['auto', tr('Automatico'), true], ['mkv', tr('MKV')], ['mp4', tr('MP4')], ['avi', tr('AVI')]],
    function(v) { cfg.vodExt = String(v); });

var setInfoSecs = settings.createInt('infoSecs', tr('Durata info canale dopo zap (sec)'), 5, 0, 30, 1, 's',
    function(v) { cfg.infoSecs = parseInt(v); });

var setLastChan = settings.createBool('lastChan', tr('Riprendi ultimo canale all\'avvio'), false, function(v) {
    cfg.lastChan = _bool(v);
});

var setUA = settings.createString('userAgent', tr('User-Agent'), '', function(v) {
    cfg.userAgent = String(v);
    applyNetTuning();
});

var setHeaders = settings.createString('headers', tr('Header HTTP extra (Nome: valore per riga)'), '', function(v) {
    cfg.headers = String(v);
});
var setRecDir = settings.createString('recDir', tr('Cartella registrazioni (vuoto = predefinita)'), '', function(v) {
    cfg.recDir = String(v);
});
var setAutoplayNext = settings.createBool('autoplayNext', tr('Autoplay episodio successivo'), true, function(v) {
    cfg.autoplayNext = _bool(v);
});

var setRefreshMin = settings.createInt('refreshMin', tr('Refresh playlist ogni (min, 0 = mai)'), 0, 0, 1440, 15, 'min', function(v) {
    cfg.refreshMin = parseInt(v) || 0;
    armAutoRefresh();
});

settings.createDivider(tr('Aspetto'));

var setShowNums = settings.createBool('showNums', tr('Mostra numeri canale in guida'), true, function(v) {
    cfg.showNums = _bool(v);
});

var setShowLogos = settings.createBool('showLogos', tr('Mostra loghi canale in guida'), true, function(v) {
    cfg.showLogos = _bool(v);
});

var setGridHours = settings.createInt('gridHours', tr('Ore visibili in guida'), 4, 2, 8, 1, 'h', function(v) {
    cfg.gridHours = parseInt(v) || 4;
});

var setPanelAlpha = settings.createInt('panelAlpha', tr('Opacita\' pannelli (%)'), 85, 30, 100, 5, '%', function(v) {
    cfg.panelAlpha = parseInt(v) || 85;
});

var setAccent = settings.createMultiOpt('accent', tr('Colore accento'),
    [['blue', tr('Blu'), true], ['green', tr('Verde')], ['orange', tr('Arancione')],
     ['red', tr('Rosso')], ['violet', tr('Viola')]],
    function(v) { cfg.accent = String(v); });

settings.createDivider(tr('Controllo genitori'));

var setPin = settings.createString('pin', tr('PIN (vuoto = disattivo)'), '', function(v) {
    cfg.pin = String(v);
});

var setSort = settings.createMultiOpt('sortMode', tr('Ordinamento cataloghi'),
    [['default', tr('Predefinito'), true], ['name', tr('Nome A-Z')], ['added', tr('Aggiunti di recente')], ['rating', tr('Voto')]],
    function(v) { cfg.sortMode = String(v); });

// la vista aggregata "Tutti" materializza l'intero catalogo in
// memoria: con liste grandi (decine di migliaia di item) o box
// da 1GB di RAM il plugin va in OOM-kill — e' successo con un
// catalogo live da 28k canali e uno VOD piu' grosso ancora.
// Opt-in esplicito con l'avviso nel titolo dell'impostazione.
var setShowAll = settings.createBool('showAll',
    tr('Vista «Tutti» nei cataloghi — ATTENZIONE: con liste grandi o poca memoria rischia il crash del plugin'),
    false, function(v) { cfg.showAll = _bool(v); });

settings.createDivider(tr('Account'));

settings.createAction('testLogin', tr('Verifica connessione'), function() {
    var x = makeXtream();
    if(x.checkLoginAsync) {
        popup.notify(tr('Verifica in corso…'), 2);
        x.checkLoginAsync(function(res) {
            popup.notify(res.status ? tr('Connessione OK') :
                (tr('Errore') + ': ' + res.error), 4);
        });
    } else {
        var res = x.checkLogin();
        popup.notify(res.status ? tr(tr('Connessione OK')) : (tr(tr('Errore')) + ': ' + res.error), 4);
    }
});

settings.createAction('loginPopup', tr('Inserisci credenziali…'), function() {
    loginPopup();
});

settings.createAction('reloadEpg', tr('Ricarica EPG adesso'), function() {
    guideFetchedAt = 0;
    guide = null;
    popup.notify(tr(tr('EPG: ricarico in corso…')), 3);
    ensureGuide(function(ok) {
        popup.notify(ok ? tr(tr('EPG aggiornata')) : tr(tr('EPG non disponibile')), 3);
    });
});

settings.createAction('reloadCatalog', tr('Ricarica liste canali/film/serie adesso'), function() {
    catalogDropAll();
    delete cache['livestreams'];
    delete cache['vodstreams'];
    delete cache['series'];
    delete cache['vodfav'];
    delete cache['seriesfav'];
    delete cache['livecats'];
    delete cache['vodcats'];
    delete cache['seriescats'];
    popup.notify(tr('Liste: ricarico in corso…'), 3);
    // scalda solo le categorie: i cataloghi si ricaricano lazy
    // per-categoria alla prossima apertura delle viste — niente
    // pre-fetch dei cataloghi interi (OOM sui box da 1GB)
    var ra = api();
    var pending = 3, got = 0;
    var fin = function(c) { pending--; if(c) got++; if(!pending)
        popup.notify(got ? tr('Liste aggiornate') :
                           tr('Liste non disponibili'), 3); };
    try {
        if(ra.getLiveCategoriesAsync) ra.getLiveCategoriesAsync(function(c) {
            if(c) cacheSet('livecats', c); fin(c); });
        else fin(ra.getLiveCategories());
        if(ra.getVodCategoriesAsync) ra.getVodCategoriesAsync(function(c) {
            if(c) cacheSet('vodcats', c); fin(c); });
        else fin(ra.getVodCategories());
        if(ra.getSeriesCategoriesAsync) ra.getSeriesCategoriesAsync(function(c) {
            if(c) cacheSet('seriescats', c); fin(c); });
        else fin(ra.getSeriesCategories());
    } catch(e) {
        popup.notify(tr('Liste non disponibili'), 3);
    }
});

settings.createInfo('version', logo,
    tr('XCtv') + ' ' + plugin.version + ' ' + tr('— client Xtream Codes per Movian.') + ' ' +
    tr('Configura server e credenziali qui sopra, poi apri il servizio dalla home.'));


/*
 *  Migration: pick up credentials saved by older versions
 *  (store/'credentials') when the settings are still empty.
 */
(function migrateCredentials() {

    try {
        var old = store.create('credentials');
        if(old && old.server && !cfg.server) setServer.model.value = decodeURIComponent(old.server);
        if(old && old.username && !cfg.username) setUser.model.value = decodeURIComponent(old.username);
        if(old && old.password && !cfg.password) setPass.model.value = decodeURIComponent(old.password);
    } catch(e) {
        console.log('xctv: credential migration failed: ' + e);
    }

})();


function loginPopup() {

    var result = popup.textDialog(tr('Server (host:porta o URL)') + ': ', true, true);
    if (result.rejected || !result.input) return;

    var link = result.input;

    result = popup.textDialog(tr('Username') + ': ', true, true);
    if (result.rejected || !result.input) return;

    var username = result.input;

    result = popup.textDialog(tr('Password') + ': ', true, true);
    if (result.rejected || !result.input) return;

    cfg.server = link;
    cfg.username = username;
    cfg.password = result.input;

    setServer.model.value = link;
    setUser.model.value = username;
    setPass.model.value = result.input;

    resetSession();
    popup.notify(tr("Credenziali salvate"), 2);
}


/*
 *  Xtream instance + data caches
 */
var xtream;
var cache = {};
var CACHE_TTL = 600; // seconds


/*
 *  makeProvider — costruisce il client per il tipo playlist:
 *  xtream (player_api), m3u (file lista remota), stalker
 *  (portale Ministra, username = MAC). `o` puo' fornire
 *  credenziali esplicite (form "Aggiungi playlist").
 */
function makeProvider(t, o) {
    o = o || {};
    var s = (o.server   !== undefined) ? o.server   : cfg.server;
    var u = (o.username !== undefined) ? o.username : cfg.username;
    var p = (o.password !== undefined) ? o.password : cfg.password;
    t = t || cfg.plType;
    var net = { debug: cfg.debug, ua: cfg.userAgent || undefined,
                headers: cfgHeaders() };
    if(t == 'm3u')
        return new M3U(s, net);
    if(t == 'stalker')
        return new Stalker(s, { username: u, password: p }, net);
    return new Xtream({ player_api: s, epg: s },
                      { username: u, password: p },
                      { debug: cfg.debug, liveExt: cfg.liveExt,
                        vodExt: cfg.vodExt,
                        ua: cfg.userAgent || undefined,
                        headers: cfgHeaders() });
}

function makeXtream() {
    return makeProvider();
}


function resetSession() {
    xtream = null;
    cache = {};
    guide = null;
    guideFetchedAt = 0;
    catalogDropAll();
}


/*
 *  cfgHeaders — "Nome: valore" per riga → oggetto header per
 *  http.request (vale per le chiamate API/EPG; gli stream video
 *  passano dal backend e non accettano header custom, per quelli
 *  c'e' il pin dello User-Agent per dominio).
 */
function cfgHeaders() {
    var h = {};
    if(!cfg.headers) return h;
    var lines = String(cfg.headers).split(/\r?\n/);
    for(var i = 0; i < lines.length; i++) {
        var p = lines[i].indexOf(':');
        if(p > 0)
            h[lines[i].substring(0, p).replace(/^\s+|\s+$/g, '')] =
             lines[i].substr(p + 1).replace(/^\s+|\s+$/g, '');
    }
    return h;
}


/*
 *  applyNetTuning — pin dello User-Agent per dominio sullo stack
 *  HTTP nativo: copre le richieste del player (stream) e le API
 *  sullo stesso host. Chiamata all'avvio e quando cambia il server.
 */
function applyNetTuning() {
    if(!cfg.userAgent) return;
    function pin(u) {
        if(!u) return;
        var url = u.indexOf('://') != -1 ? u : 'http://' + u;
        try {
            popup.injectcookies(url, { $ua: cfg.userAgent });
        } catch(e) {
            if(cfg.debug) console.log('xctv: UA pin failed for ' + url + ': ' + e);
        }
    }
    pin(cfg.server);
    if(cfg.epgUrl) pin(cfg.epgUrl);
}


/*
 *  Refresh automatico playlist: azzera la cache delle liste e la
 *  guida così la prossima apertura rilegge il server. Se la pagina
 *  live e' aperta ricarica il gruppo corrente senza toccare lo
 *  stream in corso.
 */
var refreshRes = null;

function refreshPlaylistData(silent) {
    cache = {};
    xtream = null;         // ricreato lazy da api(): svuota anche
                           // la cache interna di libxtream
    catalogDropAll();      // altrimenti catalogFromDisk serve per
                           // 12h il catalogo precedente al refresh
    guideFetchedAt = 0;
    guide = null;
    try {
        var a = api();
        // scaldare la cache non deve bloccare il contesto ES
        // (giro sul timer di auto-refresh = freeze periodico)
        if(a.getInfoAsync) a.getInfoAsync('user', function() {});
        else a.getInfo('user');
    } catch(e) {}
    if(zapPage && !prop.isZombie(zapPage.root)) {
        try { if(zapPage.reload) zapPage.reload(); } catch(e) {}
    }
    if(!silent)
        popup.notify(tr('Playlist aggiornata'), 2);
}

function armAutoRefresh() {
    if(refreshRes) { clearInterval(refreshRes); refreshRes = null; }
    if(!cfg.refreshMin) return;
    refreshRes = setInterval(function() {
        try { refreshPlaylistData(true); } catch(e) {}
    }, cfg.refreshMin * 60 * 1000);
}


var xtreamKey = '';

function api() {
    // Istanza persistente: la cache interna di libxtream
    // (liste/info/categorie) sopravvive tra un :start e l'altro;
    // si ricrea solo se cambiano playlist/credenziali.
    var key = cfg.server + '|' + cfg.username + '|' + cfg.password +
              '|' + cfg.plType + '|' + cfg.liveExt + '|' + cfg.vodExt;
    if(!xtream || xtreamKey != key) {
        xtream = makeXtream();
        xtreamKey = key;
    }
    return xtream;
}


// cachePut — scrittura condivisa con eviction lazy: le entry
// scadute non vengono mai lette ma restano in heap (una lista
// VOD puo' pesare decine di MB): si buttano quando le chiavi
// superano una soglia — niente timer dedicati
function cachePut(key, v) {
    if(v) cache[key] = { t: Math.floor(Date.now() / 1000), v: v };
    var n = 0;
    for(var k in cache)
        if(cache[k] && ++n > 40) break;
    if(n > 40) {
        var now = Math.floor(Date.now() / 1000);
        for(var k2 in cache)
            if(cache[k2] && now - cache[k2].t >= CACHE_TTL)
                delete cache[k2];
    }
}

function cached(key, fn) {
    var now = Math.floor(Date.now() / 1000);
    if(cache[key] && (now - cache[key].t) < CACHE_TTL)
        return cache[key].v;
    var v = fn();
    cachePut(key, v);
    return v;
}

// varianti per i path async: leggono il valore solo se fresco,
// settano solo valori truthy (i fallimenti non avvelenano)
function cacheGet(key) {
    var now = Math.floor(Date.now() / 1000);
    if(cache[key] && (now - cache[key].t) < CACHE_TTL)
        return cache[key].v;
    return undefined;
}
function cacheSet(key, v) {
    cachePut(key, v);
}


/*
 *  Catalogo live su disco — lo stesso modello dei player "grandi"
 *  (TiviMate/OTT): sync una tantum, poi la lista si apre da disco
 *  invece di riscaricare e ri-parsare decine di MB a ogni ingresso.
 *  File JSON in Core.storagePath/catalog.json; src lega il file
 *  a provider+server+utente cosi' un cambio playlist non mostra
 *  mai i canali di un'altra lista.
 */
var CATALOG_TTL = 12 * 3600;   // secondi

function catalogFile(kind) {
    return Core.storagePath + '/catalog-' + kind + '.json';
}

function catalogSrc() {
    return cfg.plType + '|' + cfg.server + '|' + cfg.username;
}

function catalogToDisk(kind, l) {
    try {
        var fs = require('fs');
        var at = Math.floor(Date.now() / 1000);
        fs.writeFileSync(catalogFile(kind),
            JSON.stringify({ v: 1, at: at,
                             src: catalogSrc(), l: l }));
        // sidecar "n|at|src": conteggio+freschezza in ~20 byte
        // invece di parsare decine di MB solo per l.length. src
        // puo' contenere '|' — si parsa tutto dopo il 2o pipe.
        fs.writeFileSync(catalogFile(kind) + '.n',
                         String(l.length) + '|' + at + '|' +
                         catalogSrc());
        // indice id->categoria per liveById: trovare un canale
        // non richiede piu' il parse del catalogo intero ne'
        // la scansione di tutte le categorie
        if(kind == 'live') {
            var m = {};
            for(var i = 0; i < l.length; i++) {
                var e = l[i];
                if(e && e.id != null) {
                    var c = e.cat_id;
                    if(c != null && typeof c != 'number' &&
                       typeof c != 'string' && c.length)
                        c = c[0];
                    m[String(e.id)] = c;
                }
            }
            fs.writeFileSync(catalogFile(kind) + '.idx',
                JSON.stringify({ v: 1, at: at,
                                 src: catalogSrc(), m: m }));
        }
    } catch(e) {}
}

// catalogSidecar — legge il file .n: {n, at} se valido e legato
// a questa playlist, null se assente/di altra sorgente.
// Formato nuovo "n|at|src"; vecchio "n|src" -> at=0.
function catalogSidecar(kind) {
    try {
        var raw = require('fs').readFileSync(catalogFile(kind) + '.n');
        var txt = (typeof TextDecoder == 'function') ?
            new TextDecoder().decode(raw) : String(raw);
        var p1 = txt.indexOf('|');
        if(p1 < 0) return null;
        var n = parseInt(txt.substr(0, p1), 10);
        var p2 = txt.indexOf('|', p1 + 1);
        if(p2 > 0) {
            var at = parseInt(txt.substring(p1 + 1, p2), 10);
            if(!isNaN(at) && txt.substr(p2 + 1) == catalogSrc())
                return { n: isNaN(n) ? -1 : n, at: at };
        }
        if(txt.substr(p1 + 1) == catalogSrc())
            return { n: isNaN(n) ? -1 : n, at: 0 };
        return null;
    } catch(e) {}
    return null;
}

// catalogCountFromDisk — numero di item del catalogo su disco
// senza parsare il file. -1 se assente/stale.
function catalogCountFromDisk(kind) {
    var s = catalogSidecar(kind);
    return (s && s.n >= 0) ? s.n : -1;
}

function catalogFromDisk(kind) {
    try {
        // sidecar con timestamp esplicitamente scaduto -> niente
        // parse di decine di MB solo per scoprire che e' stale
        var s = catalogSidecar(kind);
        if(s && s.at &&
           (Math.floor(Date.now() / 1000) - s.at) >= CATALOG_TTL)
            return undefined;
        var raw = require('fs').readFileSync(catalogFile(kind));
        var txt = (typeof TextDecoder == 'function') ?
            new TextDecoder().decode(raw) : String(raw);
        var o = JSON.parse(txt);
        if(!o || o.v != 1 || o.src != catalogSrc() || !o.l)
            return undefined;
        if(Math.floor(Date.now() / 1000) - o.at >= CATALOG_TTL)
            return undefined;
        return o.l;
    } catch(e) {}
    return undefined;
}

// liveCatIndexLookup — cat_id di un canale dal sidecar .idx
// (pochi KB) invece del parse del catalogo. null se assente.
function liveCatIndexLookup(id) {
    try {
        var raw = require('fs').readFileSync(catalogFile('live') + '.idx');
        var txt = (typeof TextDecoder == 'function') ?
            new TextDecoder().decode(raw) : String(raw);
        var o = JSON.parse(txt);
        if(!o || o.v != 1 || o.src != catalogSrc() || !o.m)
            return null;
        var c = o.m[String(id)];
        return (c === undefined) ? null : c;
    } catch(e) {}
    return null;
}

function catalogDrop(kind) {
    try {
        // niente unlinkSync nel modulo fs: un payload invalido
        // (v != 1) viene scartato da catalogFromDisk
        require('fs').writeFileSync(catalogFile(kind), '{}');
    } catch(e) {}
}

function catalogDropAll() {
    catalogDrop('live');
    catalogDrop('vod');
    catalogDrop('series');
}


/*
 *  EPG guide — XMLTV scaricato una volta, tenuto in memoria e su
 *  disco (epg.xml) fino alla scadenza del TTL.
 */
var guide = null;
var guideFetchedAt = 0;
var guideLoading = false;
var guideCallbacks = [];
var epgStore = store.create('epg');

// Preferiti : store persistente url -> 1 (proxy kvstore, NON
// enumerabile — i for..in itererebbero le prop interne)
var favStore = store.create('favorites');
// lista parallela enumerabile [{u,id,c,e,t,i}] — le viste
// Preferiti/Recenti si costruiscono da qui senza il catalogo
var favListStore = store.create('favlist');

// Stato sessione: ultimo canale visto, canali/gruppi nascosti.
// Lo store e' un proxy chiave→valore senza enumerazione: le
// blacklist vivono in una sola chiave serializzata ({k:1}).
var uiStore = store.create('uistate');
var hidChanStore = store.create('hiddenchan');
var hidGroupStore = store.create('hiddengroups');
// nascosti nelle pagine browse: gruppi 'vod:id'/'series:id' e
// singoli elementi (film/serie)
var hidBrowseGrpStore = store.create('hiddenbrowsegroups');
var browseOrdStore = store.create('browsegrouporder');
var hidItemStore = store.create('hiddenitems');
// preferiti di catalogo (film/serie): chiavi 'vod:id'/'series:id'
var favItemStore = store.create('itemfavorites');

// Ordine manuale elementi per categoria (browse):
// {'<kind>:<cat>' -> [vodkey, ...]} — vodkey = '<kind>:<id>'
var itemOrdStore = store.create('browseitemorder');

// Rinomina elementi (film/serie): {vodkey -> titolo personalizzato}
var nameItemStore = store.create('itemnames');

// Rinomina canali: {url -> nome personalizzato} nella sola chiave .map
var renameStore = store.create('renames');

// PIN per categoria: {'live:<cat>'|'vod:<cat>'|'series:<cat>' -> 1}
var lockStore = store.create('lockedcats');

// Playlist multiple: {list:[{n,s,u,p,e,t}], active:idx} — t = tipo
// ('xtream' default, 'm3u', 'stalker')
var plStore = store.create('playlists');

// Ordine manuale canali per gruppo: {'<cat>': [url, url, ...]}
var ordStore = store.create('chanorder');

// Ordine manuale dei gruppi: {list: ['fav','recent','all','12',...]}
var grpOrdStore = store.create('grouporder');

// Numerazione personalizzata: {url -> numero canale}
var numStore = store.create('channums');

// Indice registrazioni completate/in corso: {list: [{p,t,st}]}
// (fs non espone readdir: l'elenco dei file viene da qui)
var recListStore = store.create('reclist');

// Promemorie programmi (solo notifica, niente registrazione):
// {list: [{t, c, st, sp, sid}]}
var remStore = store.create('reminders');

// Episodi visti: {canonicalUrl -> 1}
var watchStore = store.create('watched');

/*
 *  Marker "visto" sugli episodi — store 'watched' in chiave
 *  'map' ({cu: ts}) come gli altri store mappa: le vecchie
 *  chiavi per-URL restano lette in fallback. Cap a 2000
 *  entry con eviction delle piu' vecchie, altrimenti il
 *  file cresce per sempre.
 */
function watchMark(cu) {
    var m = hidMap(watchStore);
    var nm = {};
    for(var k in m) nm[k] = m[k];
    nm[cu] = Math.floor(Date.now() / 1000);
    var keys = Object.keys(nm);
    if(keys.length > 2000) {
        keys.sort(function(a, b) { return (nm[a] || 0) - (nm[b] || 0); });
        var drop = keys.length - 2000;
        for(var d = 0; d < drop; d++) delete nm[keys[d]];
    }
    watchStore.map = nm;
}

function watchIs(cu) {
    var m = hidMap(watchStore);
    if(m[cu]) return 1;
    return watchStore[cu] ? 1 : 0;   // chiavi legacy per-URL
}

/*
 *  Tasti numerici → zap diretto. I tasti 0-9 arrivano come eventi
 *  "unicode" sul global.eventSink (solo se nessun widget di testo
 *  li consuma). La sottoscrizione e' unica a livello plugin e
 *  delega alla pagina live correntemente registrata + in primo
 *  piano: digits accumulano, Enter (unicode 13) o overflow del
 *  numero di canali confermano lo zap.
 */
var zapPage = null;

/*
 *  Tiene traccia della pagina in primo piano: il navigator seleziona
 *  il propRoot della pagina corrente dentro la sua dir "pages"
 *  (selectchild). I link prop non sono DIR (enumerate li filtra), ma
 *  getChild per indice usa GetChildren che segue linkedTo → i figli
 *  reali del navigator root.
 */
/*
 *  Pagina corrente: cur prop e' "navigators.current" (linkselected →
 *  nav root). Cerco il figlio "currentpage" per INDICE — getChild
 *  numerico usa GetChildren che segue linkedTo, mentre l'accesso per
 *  nome creerebbe uno shadow vuoto sul link. Lo stesso prop.has su
 *  currentpage segue il link fino al propRoot della pagina attiva,
 *  dove la pagina live marca il figlio "zaplive".
 */
function childByName(dir, name, max) {
    for(var i = 0; i < max; i++) {
        var ch = prop.getChild(dir, i);
        // GetChildren e' uno slice contiguo: il primo null e' la
        // fine della lista (niente buchi di indice)
        if(!ch) return null;
        if(prop.getName(ch) == name) return ch;
    }
    return null;
}

function liveIsCurrent() {
    var cur = prop.global.navigators.current;
    var cp = childByName(cur, 'currentpage', 64);
    return !!(cp && childByName(cp, 'zaplive', 128));
}

// URL della pagina attualmente selezionata dal navigator —
// il link "currentpage" viene seguito da GetChildren ad ogni
// chiamata, quindi riflette sempre la pagina corrente.
function currentPageUrl() {
    var cur = prop.global.navigators.current;
    var cp = childByName(cur, 'currentpage', 64);
    if(!cp) return null;
    var u = childByName(cp, 'url', 128);
    return u ? String(prop.makeProp(u)) : null;
}

function liveTransportUrl(url) {
    var u = String(url || '');
    if(cfg.plType != 'xtream' || !u) return u;
    var ext = cfg.liveExt;
    try {
        if(!ext || ext == 'auto') {
            var a = api();
            ext = a && a.liveExtension ? a.liveExtension() : 'm3u8';
        }
    } catch(e) {
        ext = 'm3u8';
    }
    if(ext != 'm3u8' && ext != 'ts') return u;
    return u.replace(/(\/live\/[^/?#]+\/[^/?#]+\/\d+)\.(?:m3u8|ts)([?#].*)?$/i,
                     '$1.' + ext + '$2');
}

function livePlaybackLifecycle(page) {
    var myUrl = String(page.root.url);
    var heldZap = null;
    var disposed = false;
    var navSub = null;
    var pageSub = null;
    var pages = childByName(prop.global.navigators.current, 'pages', 64);
    if(!pages) throw new Error('Live navigator pages unavailable');

    function dispose() {
        if(disposed) return;
        disposed = true;
        heldZap = null;
        if(navSub) { navSub.destroy(); navSub = null; }
        if(pageSub) { pageSub.destroy(); pageSub = null; }
    }

    function sync() {
        if(disposed) return;
        if(prop.isZombie(page.root)) { dispose(); return; }
        var m = page.model;
        if(currentPageUrl() == myUrl) {
            if(heldZap !== null) {
                var restore = heldZap;
                heldZap = null;
                m.zapurl = restore;
            }
        } else {
            var z = prop.getValue(m.zapurl);
            if(typeof z == 'string' && z) {
                heldZap = z;
                m.zapurl = '';
            }
        }
    }

    navSub = prop.subscribe(pages, function(type) {
        if(type == 'selectchild') sync();
        else if(type == 'destroyed') { navSub = null; dispose(); }
    }, { autoDestroy: true, noInitialUpdate: true });
    pageSub = prop.subscribe(page.root, function(type) {
        if(type == 'destroyed') { pageSub = null; dispose(); }
    }, { autoDestroy: true, noInitialUpdate: true });
    sync();

    return {
        set: function(url) {
            if(disposed) return;
            if(prop.isZombie(page.root)) { dispose(); return; }
            if(currentPageUrl() == myUrl) {
                heldZap = null;
                page.model.zapurl = url;
            } else {
                heldZap = url || null;
                var z = prop.getValue(page.model.zapurl);
                if(typeof z == 'string' && z) page.model.zapurl = '';
            }
        }
    };
}

prop.subscribe(prop.global.eventSink, function(type, val) {
    try {
        if(type != 'unicode' || !zapPage || prop.isZombie(zapPage.root))
            return;
        var isLive = liveIsCurrent();
        if(cfg.debug)
            print('xctv: keysink unicode val=' + val +
                  ' isLive=' + !!isLive);
        if(!isLive) return;

        var m = zapPage.model;

        if(val == 13 || val == 10) {                 // Enter → zap
            if(zapPage.numbuf > 0) {
                zapPage.zap(zapPage.numbuf);
                zapPage.numbuf = 0;
                m.numinput = 0;
            }
            return;
        }
        if(val == 27 || val == 8) {                  // Esc/Backspace → azzera
            zapPage.numbuf = 0;
            m.numinput = 0;
            return;
        }
        if(val < 48 || val > 57) return;

        var now = Math.floor(Date.now() / 1000);
        if(zapPage.numts && now - zapPage.numts > 3)
            zapPage.numbuf = 0;
        zapPage.numts = now;
        zapPage.numbuf = zapPage.numbuf * 10 + (val - 48);
        var n = zapPage.count();
        if(zapPage.numbuf > n)
            zapPage.numbuf = val - 48;
        m.numinput = zapPage.numbuf;
        if(zapPage.numbuf * 10 > n) {                // non estendibile → zap
            zapPage.zap(zapPage.numbuf);
            zapPage.numbuf = 0;
            m.numinput = 0;
        }
    } catch(e) {}
}, {
    autoDestroy: true,
});

function hidMap(st) { return st.map || {}; }
function hidSet(st, k, on) {
    var m = {};
    var old = st.map || {};
    for(var x in old) m[x] = old[x];
    if(on) m[k] = 1; else delete m[k];
    st.map = m;   // nuovo riferimento → il proxy salva
}
function isHiddenChan(u)  { return !!hidMap(hidChanStore)[u]; }
function isHiddenGroup(c) { return !!hidMap(hidGroupStore)[c]; }
function isLockedCat(k)   { return !!hidMap(lockStore)[k]; }
function isHiddenBrowseGroup(kind, c) {
    return !!hidMap(hidBrowseGrpStore)[kind + ':' + c];
}

/*
 *  blockedCatMap — insieme {catid:1} dei gruppi nascosti o
 *  bloccati dal PIN: i loro contenuti restano esclusi dalle
 *  viste aggregate (Tutti/Preferiti/Recenti/ricerca) — il gate
 *  sul solo rail li lascerebbe raggiungibili senza PIN.
 *  kind: 'vod'|'series'|'live'; cats: [{id|cat,title}] usati
 *  per l'euristica pinLocked sui nomi gruppo.
 */
function blockedCatMap(kind, cats) {

    var m = {};
    var pfx = kind + ':';

    if(kind == 'live') {
        // live: 'hiddengroups' usa la chiave cat_id nuda
        var hg = hidMap(hidGroupStore);
        for(var hk in hg) if(hg[hk]) m[hk] = 1;
        if(cfg.pin) {
            var lg = hidMap(lockStore);
            for(var lk in lg)
                if(lg[lk] && lk.indexOf(pfx) == 0)
                    m[lk.substr(pfx.length)] = 1;
        }
    } else {
        var hg2 = hidMap(hidBrowseGrpStore);
        for(var hk2 in hg2)
            if(hg2[hk2] && hk2.indexOf(pfx) == 0)
                m[hk2.substr(pfx.length)] = 1;
        if(cfg.pin) {
            var lg2 = hidMap(lockStore);
            for(var lk2 in lg2)
                if(lg2[lk2] && lk2.indexOf(pfx) == 0)
                    m[lk2.substr(pfx.length)] = 1;
        }
    }

    if(cfg.pin && cats)
        for(var i = 0; i < cats.length; i++)
            if(cats[i] && pinLocked(cats[i].title)) {
                var cid = cats[i].id != null ? cats[i].id : cats[i].cat;
                if(cid != null) m[String(cid)] = 1;
            }
    return m;
}
function isHiddenBrowseItem(kind, id) {
    return !!hidMap(hidItemStore)[kind + ':' + id];
}
function isFavItem(kind, id) {
    return !!hidMap(favItemStore)[kind + ':' + id];
}
function hasFavItems(kind) {
    var m = hidMap(favItemStore), p = kind + ':';
    for(var k in m) if(k.indexOf(p) == 0) return true;
    return false;
}

// ordine manuale dei gruppi nelle pagine browse (vod/series)
function saveBrowseOrder(kind, groups) {
    var keys = [];
    for(var i = 0; i < groups.length; i++)
        keys.push(grpKey(groups[i].cat));
    browseOrdStore[kind] = keys;
}

// ordine manuale elementi dentro una categoria browse:
// itemOrdStore['<kind>:<cat>'] = [vodkey,...]. Le chiavi assenti
// restano in coda in ordine catalogo (nuovi ingressi provider).
function applyItemOrder(list, ordKey, kind) {
    var saved = itemOrdStore[ordKey];
    if(!saved || !saved.length) return list;
    var rank = {};
    for(var i = 0; i < saved.length; i++) rank[saved[i]] = i;
    var dec = [];
    for(var i = 0; i < list.length; i++)
        dec.push({ it: list[i], i: i });
    dec.sort(function(a, b) {
        var ra = rank[kind + ':' + a.it.id];
        var rb = rank[kind + ':' + b.it.id];
        if(ra === undefined) ra = 1e9;
        if(rb === undefined) rb = 1e9;
        return ra != rb ? ra - rb : a.i - b.i;
    });
    var out = [];
    for(var i = 0; i < dec.length; i++) out.push(dec[i].it);
    return out;
}

// la categoria e' riordinabile manualmente: fuori da 'history' e
// 'all' (ordini di grandi numeri / lista derivata) e solo con
// ordinamento catalogo 'default' (gli altri modi hanno una
// semantica propria e confliggerebbero)
function canOrderItems(kind, cat) {
    return kind != 'eps' && cat != 'history' && cat != 'all' &&
           cfg.sortMode == 'default';
}

/*
 *  Rinomina canali — s.otitle conserva il nome originale (usato
 *  per il matching EPG), s.title e' il nome mostrato.
 */
function applyRename(s, m) {
    if(s.otitle === undefined) s.otitle = s.title;
    if(m === undefined) m = renameStore.map || {};
    s.title = m[s.source.url] || s.otitle;
}

function setChanName(s, name) {
    var m = {};
    var old = renameStore.map || {};
    for(var x in old) m[x] = old[x];
    if(name) m[s.source.url] = name; else delete m[s.source.url];
    renameStore.map = m;
    applyRename(s);
}

/*
 *  Playlist multiple — plStore.list = [{n,s,u,p,e}], plStore.active.
 *  cfg.server/username/password/epgUrl restano la "working copy"
 *  della playlist attiva: applyPlaylist la sincronizza.
 */
function plList() { return plStore.list || []; }

function applyPlaylist(i) {
    var l = plList();
    if(i < 0 || i >= l.length) return false;
    plStore.active = i;
    var p = l[i];
    cfg.playName = p.n || 'XCtv';
    cfg.server = p.s || '';
    cfg.username = p.u || '';
    cfg.password = p.p || '';
    cfg.epgUrl = p.e || '';
    cfg.plType = p.t || 'xtream';
    setName.model.value = cfg.playName;
    setServer.model.value = cfg.server;
    setUser.model.value = cfg.username;
    setPass.model.value = cfg.password;
    setEpgUrl.model.value = cfg.epgUrl;
    resetSession();
    applyNetTuning();
    return true;
}

function savePlEntry(name, s, u, p, e, idx, t) {
    var l = plList().slice();
    var ent = { n: name || 'XCtv', s: s || '', u: u || '', p: p || '',
                e: e || '', t: t || 'xtream' };
    if(idx != null && idx >= 0 && idx < l.length)
        l[idx] = ent;
    else {
        l.push(ent);
        idx = l.length - 1;
    }
    plStore.list = l;
    return idx;
}

// Migrazione: credenziali singole -> prima voce playlist
(function migratePlaylists() {
    try {
        if(!plList().length && cfg.server)
            plStore.list = [{ n: cfg.playName || 'XCtv', s: cfg.server,
                              u: cfg.username, p: cfg.password,
                              e: cfg.epgUrl || '' }];
        if(plStore.active == null) plStore.active = 0;
    } catch(e) {}
})();

// All'avvio la playlist attiva dello store vince sui settings
function syncActivePl() {
    var l = plList();
    if(!l.length) return;
    var a = plStore.active;
    if(a == null || a < 0 || a >= l.length) a = 0;
    var p = l[a];
    if(p && (p.s != cfg.server || p.u != cfg.username))
        applyPlaylist(a);
}


/*
 *  Sleep timer — dopo N minuti ferma la riproduzione live:
 *  azzerare model.zapurl spegne il widget video della pagina.
 */
var sleepTimerRes = null;
var sleepMin = 0;

function armSleep(min) {

    sleepMin = min;
    if(sleepTimerRes) {
        try { clearInterval(sleepTimerRes); } catch(e) {}
        sleepTimerRes = null;
    }
    if(!min) {
        popup.notify(tr('Sleep timer disattivato'), 2);
        return;
    }

    var fireAt = Date.now() + min * 60000;
    popup.notify(tr('Sleep timer: spegnimento tra') + ' ' + min + ' ' + tr('min'), 3);

    sleepTimerRes = setInterval(function() {
        try {
            if(Date.now() < fireAt) return;
            clearInterval(sleepTimerRes);
            sleepTimerRes = null;
            sleepMin = 0;
            if(zapPage && !prop.isZombie(zapPage.root) && liveIsCurrent())
                zapPage.model.zapurl = '';
            popup.notify(tr('Sleep timer: riproduzione fermata'), 3);
        } catch(e) {}
    }, 15000);
}


/*
 *  Backup/restore — gli store del plugin sono file JSON sotto
 *  Core.storagePath/store/ e i settings sotto settings/<id>:
 *  il backup e' un unico JSON con tutto dentro.
 */
var BACKUP_PATH = ((typeof Core != 'undefined' && Core.storagePath) ?
                   Core.storagePath : '.') + '/xctv-backup.json';
var BACKUP_STORES = ['favorites', 'hiddenchan', 'hiddengroups', 'history',
                     'renames', 'lockedcats', 'uistate', 'playlists',
                     'chanorder', 'channums', 'reclist', 'reminders',
                     'watched', 'recsched', 'hiddenbrowsegroups',
                     'browsegrouporder', 'hiddenitems', 'itemfavorites',
                     'browseitemorder', 'itemnames'];

function _fsText(buf) {
    if(!buf) return null;
    if(typeof TextDecoder == 'function')
        try { return new TextDecoder().decode(buf); } catch(e) {}
    return String(buf);
}

function backupNow() {

    try {
        var fs = require('fs');
        var data = { version: 1, app: 'xctv',
                     when: new Date().toISOString(), stores: {} };

        var sp = Core.storagePath + '/settings/' + plugin.id;
        data.settings = JSON.parse(_fsText(fs.readFileSync(sp)) || '{}');

        for(var i = 0; i < BACKUP_STORES.length; i++) {
            var nm = BACKUP_STORES[i];
            try {
                data.stores[nm] = JSON.parse(_fsText(
                    fs.readFileSync(Core.storagePath + '/store/' + nm)) || '{}');
            } catch(e2) {
                data.stores[nm] = {};
            }
        }

        fs.writeFileSync(BACKUP_PATH, JSON.stringify(data, null, 2));
        popup.notify(tr('Backup salvato') + ': ' + BACKUP_PATH, 5);
    } catch(e) {
        popup.notify(tr('Backup fallito') + ': ' + e, 4);
    }
}

function restoreNow() {

    try {
        var fs = require('fs');
        var data = JSON.parse(_fsText(fs.readFileSync(BACKUP_PATH)) || 'null');
        if(!data) throw tr('file di backup non leggibile');

        // settings → propaga via model.value (persiste + aggiorna
        // cfg). Le chiavi assenti nel backup sono "mai cambiate dal
        // default" → si ripristina il default.
        var s = data.settings || {};
        var DEF = { server: '', username: '', password: '',
                    playName: 'XCtv', epg: true, epgUrl: '',
                    epgTtlH: 8, epgOffsetMin: 0, epgOnStart: true,
                    liveExt: 'auto', vodExt: 'auto', infoSecs: 5,
                    lastChan: false, showNums: true, showLogos: true,
                    pin: '', sortMode: 'default', debug: false,
                    userAgent: '', headers: '', gridHours: 4,
                    panelAlpha: 85, accent: 'blue', refreshMin: 0,
                    recDir: '', autoplayNext: true };
        function sk(k) { return (k in s) ? s[k] : DEF[k]; }

        setServer.model.value = sk('server');
        setUser.model.value = sk('username');
        setPass.model.value = sk('password');
        setName.model.value = sk('playName');
        setEpg.model.value = sk('epg');
        setEpgUrl.model.value = sk('epgUrl');
        setEpgTtl.model.value = sk('epgTtlH');
        setEpgOffset.model.value = sk('epgOffsetMin');
        setEpgOnStart.model.value = sk('epgOnStart');
        setMultiOptVal('liveExt', sk('liveExt'));
        setMultiOptVal('vodExt', sk('vodExt'));
        setInfoSecs.model.value = sk('infoSecs');
        setLastChan.model.value = sk('lastChan');
        setShowNums.model.value = sk('showNums');
        setShowLogos.model.value = sk('showLogos');
        setPin.model.value = sk('pin');
        setMultiOptVal('sortMode', sk('sortMode'));
        setDebug.model.value = sk('debug');
        setUA.model.value = sk('userAgent');
        setHeaders.model.value = sk('headers');
        setGridHours.model.value = sk('gridHours');
        setPanelAlpha.model.value = sk('panelAlpha');
        setMultiOptVal('accent', sk('accent'));
        setRefreshMin.model.value = sk('refreshMin');
        setRecDir.model.value = sk('recDir');
        setAutoplayNext.model.value = sk('autoplayNext');

        // cfg subito (le callback dei model.value sono asincrone)
        for(var k in DEF)
            cfg[k] = sk(k);

        // store a mappa/lista: sostituzione intera (non merge, le
        // chiavi assenti nel backup vanno rimosse)
        var so = data.stores || {};
        if(so.hiddenchan)     hidChanStore.map = so.hiddenchan.map || {};
        if(so.hiddengroups)   hidGroupStore.map = so.hiddengroups.map || {};
        if(so.renames)        renameStore.map = so.renames.map || {};
        if(so.lockedcats)     lockStore.map = so.lockedcats.map || {};
        if(so.history)        histStore.list = so.history.list || [];
        if(so.reclist)        recListStore.list = so.reclist.list || [];
        if(so.reminders)      remStore.list = so.reminders.list || [];
        if(so.recsched)       schedStore.list = so.recsched.list || [];
        if(so.watched)
            for(var wk in so.watched)
                watchStore[wk] = so.watched[wk];
        // store browse: .map per gli store a mappa unica, copia per
        // chiave per quelli a chiavi arbitrarie (kvstore proxy)
        if(so.hiddenbrowsegroups)
            hidBrowseGrpStore.map = so.hiddenbrowsegroups.map || {};
        if(so.hiddenitems)
            hidItemStore.map = so.hiddenitems.map || {};
        if(so.itemfavorites)
            favItemStore.map = so.itemfavorites.map || {};
        if(so.itemnames)
            nameItemStore.map = so.itemnames.map || {};
        if(so.browsegrouporder)
            for(var bo in so.browsegrouporder)
                browseOrdStore[bo] = so.browsegrouporder[bo];
        if(so.browseitemorder)
            for(var io in so.browseitemorder)
                itemOrdStore[io] = so.browseitemorder[io];
        if(so.playlists) {
            if(so.playlists.list != null)   plStore.list = so.playlists.list;
            if(so.playlists.active != null) plStore.active = so.playlists.active;
        }
        if(so.uistate)
            for(var uk in so.uistate)
                uiStore[uk] = so.uistate[uk];

        // favorites (chiavi arbitrarie url->1): scrivo il file
        // direttamente (le chiavi rimosse tornano esatte al riavvio)
        // e aggiorno la memoria per quelle ripristinate
        var favs = (data.stores || {}).favorites;
        if(favs) {
            for(var fk in favs)
                try { favStore[fk] = favs[fk]; } catch(e4) {}
            try {
                fs.writeFileSync(Core.storagePath + '/store/favorites',
                                 JSON.stringify(favs));
            } catch(e3) {}
            // favlist ricostruita allo store dei preferiti al
            // prossimo accesso (migrazione filtrata)
            try { favListStore.mig = 0; favListStore.list = []; }
            catch(e5) {}
        }

        resetSession();
        popup.notify(tr('Backup ripristinato (i preferiti saranno attivi al riavvio)'), 4);
    } catch(e) {
        popup.notify(tr('Ripristino fallito') + ': ' + e, 4);
    }
}


/*
 *  Esporta i preferiti come playlist M3U standard, riusabile in
 *  altri player. Canali ordinati per gruppo; metadati tvg
 *  (logo, epg id) preservati.
 */
function exportFavoritesM3U() {

    // preferiti dalla vista "fav" dello store: niente fetch del
    // catalogo intero (entry arricchite; le legacy si risolvono
    // con la scansione filtrata dentro liveStoreList+loader —
    // qui i campi mancanti restano vuoti, l'export resta utile)
    var sl = liveStoreList('fav');
    var live = sl.list;
    liveCats(function(cats) { try {
        cats = cats || [];
        var catName = {};
        for(var ci = 0; ci < cats.length; ci++)
            catName[String(cats[ci].id)] = cats[ci].title;

        var lines = ['#EXTM3U'];
        var n = 0;
        for(var i = 0; i < live.length; i++) {
            var s = live[i];
            if(!favStore[s.source.url]) continue;
            var grp = catName[String(s.cat_id)] || '';
            lines.push('#EXTINF:-1 tvg-id="' + (s.epgid || '') +
                       '" tvg-name="' + s.title.replace(/"/g, "'") +
                       '" tvg-logo="' + (s.icon || '') +
                       '" group-title="' + grp.replace(/"/g, "'") +
                       '",' + s.title);
            lines.push(s.source.url);
            n++;
        }

        if(!n) {
            popup.notify(tr('Nessun preferito da esportare'), 3);
            return;
        }

        var out = Core.storagePath + '/xctv-favorites.m3u';
        require('fs').writeFileSync(out, lines.join('\n') + '\n');
        popup.notify(tr('Preferiti esportati') + ' (' + n + ' ' +
                     tr('canali') + '): ' + out, 6);
    } catch(e) {
        popup.notify(tr('Esportazione fallita') + ': ' + e, 4);
    } });
}


// "Continua a guardare": cronologia riproduzioni VOD/episodi
// (voce rail in cima alle sezioni Film/Serie). Ogni elemento:
// {t: titolo, i: icona, u: play url, k: 'vod'|'series'}.
var histStore = store.create('history');
var HIST_MAX = 50;

function histAdd(title, icon, playUrl, kind, extra) {

    var list = histStore.list || [];
    // dedup sulla stessa URL
    var out = [];
    for(var i = 0; i < list.length; i++)
        if(list[i].u != playUrl) out.push(list[i]);

    var e = { t: title, i: icon || '', u: playUrl, k: kind };
    // metadati opzionali (id stream, categoria, epgid) — la
    // vista Recenti si ricostruisce dallo store senza fetch
    if(kind == 'live' && extra) {
        e.id = extra.id; e.c = extra.c; e.e = extra.e || '';
    }
    out.unshift(e);
    if(out.length > HIST_MAX) out.length = HIST_MAX;
    histStore.list = out;
}

/*
 *  Scritture store debounced — ad ogni zap si scriverebbero
 *  due file kvstore (history + uistate): si accumulano e si
 *  scaricano dopo 4s di quiete. Solo per i path ad alta
 *  frequenza (cambio canale): le altre scritture restano
 *  immediate.
 */
var debFlushRes = null;
var debUi = {};
var debHist = [];

function flushDeb() {
    debFlushRes = null;
    try {
        for(var k in debUi) uiStore[k] = debUi[k];
        debUi = {};
        var hs = debHist;
        debHist = [];
        for(var i = 0; i < hs.length; i++)
            histAdd(hs[i].t, hs[i].i, hs[i].u, hs[i].k, hs[i].x);
    } catch(e) {}
}

function uiSetDeb(k, v) {
    debUi[k] = v;
    if(!debFlushRes) debFlushRes = setTimeout(flushDeb, 4000);
}

function histAddDeb(title, icon, playUrl, kind, extra) {
    debHist.push({ t: title, i: icon || '', u: playUrl, k: kind, x: extra });
    if(!debFlushRes) debFlushRes = setTimeout(flushDeb, 4000);
}

// URL della pagina impostazioni del plugin (registrata da
// settings.globalSettings) per la voce "Impostazioni" del menu.
var settingsUrl = null;
try {
    if(settings.properties && settings.properties.url)
        settingsUrl = settings.properties.url;
} catch(e) {}


function guideFresh() {
    var now = Math.floor(Date.now() / 1000);
    return guide && (now - guideFetchedAt) < cfg.epgTtlH * 3600;
}


/*
 *  ensureGuide(cb) — cb(ok) called when a guide is available
 *  (or definitively unavailable). Fetch/parse happens async so
 *  the page is not blocked.
 */
/*
 *  guideIngest — preslice + parse + cache disco di un documento
 *  XMLTV. Ritorna true se la guida e' pronta. Il file epg.xml
 *  salvato e' gia' ridotto: alla prossima lettura il parse resta
 *  veloce anche con feed originali da centinaia di MB.
 */
function guideIngest(xmltxt, save) {

    if(!xmltxt || xmltxt.indexOf('<') == -1) return false;

    var g = new XmlTv({ debug: cfg.debug });
    var names = collectChannelNames();
    var want = (names && names.length && g.wantFor) ?
        g.wantFor(names) : null;
    var idSet = {};
    for(var ni = 0; ni < names.length; ni++)
        idSet[names[ni]] = true;

    // scan: parser a stringhe, niente DOM — su feed da decine di MB
    // xml.parse costa centinaia di MB di RAM e minuti di CPU.
    if(!g.scan(xmltxt, want, idSet)) {
        if(cfg.debug)
            console.log('xctv: XmlTv.scan failed, len=' + xmltxt.length);
        return false;
    }

    guide = g;
    guideFetchedAt = Math.floor(Date.now() / 1000);

    // cache su disco in JSON: al prossimo avvio niente re-parse
    // XML, solo JSON.parse (ordine di grandezza piu' veloce e
    // molto piu' compatto del documento XMLTV).
    if(save) {
        try {
            var fsw = require('fs');
            fsw.writeFileSync(Core.storagePath + '/epg.json',
                JSON.stringify({ v: 2, byId: g.byId, alias: g.alias,
                                 channels: g.channels }));
            epgStore.fetchedAt = Math.floor(Date.now() / 1000);
            epgStore.url = epgSourceUrl();
        } catch(e) {}
    }
    return true;
}


// Carica la guida dalla cache disco (epg.json; fallback una tantum
// sul vecchio epg.xml scansionandolo). Ritorna true se pronta.
function guideFromDisk() {

    var fs = require('fs');
    var jf = Core.storagePath + '/epg.json';

    try {
        var raw = fs.readFileSync(jf);
        var txt = (typeof TextDecoder == 'function') ?
            new TextDecoder().decode(raw) : String(raw);
        var obj = JSON.parse(txt);
        // v2 = finestra -12h/+48h + desc troncata; le cache piu'
        // vecchie (documento completo) vengono ignorate: parse di
        // decine di MB costa piu' del download
        if(obj && obj.v == 2 && obj.byId) {
            var g = new XmlTv({ debug: cfg.debug });
            g.byId = obj.byId;
            g.alias = obj.alias || {};
            g.channels = obj.channels || {};
            g.fetchedAt = epgStore.fetchedAt;
            guide = g;
            guideFetchedAt = Math.floor(Date.now() / 1000);
            return true;
        }
    } catch(e) {}

    // Transizione dal formato vecchio: epg.xml intero ancora
    // fresco -> scan (una volta) poi salvato come json.
    try {
        var rawx = fs.readFileSync(Core.storagePath + '/epg.xml');
        var xmltxt = (typeof TextDecoder == 'function') ?
            new TextDecoder().decode(rawx) : String(rawx);
        return guideIngest(xmltxt, true);
    } catch(e) {
        console.log('xctv: epg disk cache read failed: ' + e);
    }
    return false;
}


function guideFinish(ok) {
    guideLoading = false;
    var cbs = guideCallbacks;
    guideCallbacks = [];
    for(var i = 0; i < cbs.length; i++) {
        try { cbs[i](ok); } catch(e) {}
    }
}


/*
 *  Il caricamento gira differito (setTimeout) e il download di rete
 *  usa http.request in async — fetch su un task thread del runtime,
 *  la UI resta libera. La lettura del cache disco e' veloce perche'
 *  epg.xml e' gia' il documento ridotto.
 */
function ensureGuide(cb) {

    if(!cfg.epg) { cb(false); return; }

    if(guideFresh()) { cb(true); return; }

    guideCallbacks.push(cb);
    if(guideLoading) return;
    guideLoading = true;

    setTimeout(function() {

        if(guideFresh()) { guideFinish(true); return; }

        var now = Math.floor(Date.now() / 1000);

        // disk cache + fetch entrano in funzione solo se il gate
        // li consente — il controllo dimensione viene PRIMA del
        // parse di epg.json (decine di MB sul thread ES)
        var diskAndFetch = function() {
            if(epgStore.fetchedAt &&
               (now - epgStore.fetchedAt) < cfg.epgTtlH * 3600 &&
               epgStore.url == epgSourceUrl()) {
                var okd = false;
                try { okd = guideFromDisk(); } catch(e) {
                    console.log('xctv: epg disk load failed: ' + e);
                }
                if(okd) { guideFinish(true); return; }
            }
            doFetch();
        };

        // network — fetch asincrona su task thread, callback a
        // download completato (preslice+parse sono CPU-bound e
        // restano sul thread JS, ma il documento e' piccolo)
        var done = false;
        var fin = function(body) {
            if(done) return;
            done = true;
            // collectChannelNames usa cacheGet('livestreams') —
            // assente sui cataloghi per-categoria, il filtro
            // wantFor resta vuoto e la guida ingestisce tutto
            var ok = false;
            try { ok = guideIngest(body, true); } catch(e) {
                console.log('xctv: EPG ingest failed: ' + e);
            }
            guideFinish(ok);
        };

        var doFetch = function() {
            try {
                if(cfg.epgUrl) {
                    require('movian/http')
                        .request(cfg.epgUrl, { method: 'GET', compression: true,
                                               connectTimeout: 5000,
                                               readTimeout: 120000,
                                               headers: { 'User-Agent': 'movian-go' } },
                                 function(err, res) {
                            var body = false;
                            try {
                                if(!err && res) {
                                    body = res.toString();
                                    if(body.indexOf('<') == -1) body = false;
                                }
                            } catch(e) { body = false; }
                            fin(body);
                        });
                } else {
                    api().getEpgAsync(fin);
                }
            } catch(e) {
                console.log('xctv: EPG fetch failed: ' + e);
                fin(false);
            }
        };

        // La dimensione del catalogo decide se il documento XMLTV
        // bulk e' scaricabile: su pannelli da decine di migliaia
        // di canali xmltv.php pesa centinaia di MB decompressi e
        // bufferizzarlo intero manda il processo in OOM sui box
        // da ~1GB (misurato ~500MB di picco). Oltre la soglia il
        // download si salta: la pagina ricade sul fallback
        // get_short_epg per canale (coda bounded, 4 in volo).
        // Il gate NON deve materializzare il catalogo: cache e
        // disco danno la dimensione reale; senza catalogo si usa
        // il numero di categorie (gia' in cache per il rail) —
        // tanti gruppi = lista enorme. Prima liveStreams() qui
        // scaricava 437 categorie intere SOLO per il controllo.
        var gate = function(n) {
            if(n > BULK_EPG_MAX) {
                console.log('xctv: catalogo grande (' + n +
                    ') — niente XMLTV bulk, EPG per-canale');
                guideFinish(false);
                return;
            }
            diskAndFetch();
        };
        // il conteggio arriva dal sidecar .n (10 byte) o dalla
        // cache calda — MAI dal parse del catalogo intero su disco
        var cl = cacheGet('livestreams');
        if(cl) { gate(cl.length); return; }
        var cn = catalogCountFromDisk('live');
        if(cn >= 0) { gate(cn); return; }
        liveCats(function(cats) {
            // categorie non disponibili = dimensione ignota: NON
            // scaricare il bulk — su cataloghi grandi sarebbe il
            // caso OOM. Il fallback per-canale copre l'EPG.
            if(!cats) { guideFinish(false); return; }
            try { gate(cats.length * BULK_EPG_CATMULT); }
            catch(e) { guideFinish(false); }
        });
    }, 0);
}


// Oltre questa dimensione del catalogo live il documento XMLTV
// completo non viene scaricato — vedi ensureGuide. Quando il
// catalogo non e' materializzato la stima usa #categorie ×
// CATMULT (canali medi per gruppo su un pannello tipico).
var BULK_EPG_MAX = 6000;
var BULK_EPG_CATMULT = 64;


function epgSourceUrl() {
    return cfg.epgUrl ? cfg.epgUrl : ('xtream:' + cfg.server);
}


var lastStreams = null;

// cache di sessione per la sezione Info (account/server):
// evita un getInfo per ogni apertura delle impostazioni
var infoStoreCache = {};

// Larghezza della finestra guida in secondi — ore configurabili.
function gridSpan() { return (cfg.gridHours || 4) * 3600; }
var GRIDSPAN = 3 * 3600; // fallback: usare gridSpan()
function collectChannelNames(streams) {
    var names = [];
    if(!streams) streams = cacheGet('livestreams');
    if(streams) {
        lastStreams = streams;
        for(var i = 0; i < streams.length; i++) {
            if(streams[i].epgid) names.push(streams[i].epgid);
            if(streams[i].title) names.push(streams[i].title);
        }
    }
    return names;
}


/*
 *  Inietta il modello EPG canonico (metadata.events.{list,current,next})
 *  su un item canale. evs: [{title,desc,start,stop}...] ordinati.
 */
function setChannelEvents(item, evs, url) {

    if(!evs || !evs.length) return;

    try {
        if(prop.isZombie(item.root)) return;

        var now = Math.floor(Date.now() / 1000);
        var evdir = item.root.metadata.events;
        var list = evdir.list;

        try { prop.unlink(evdir.current); } catch(e) {}
        try { prop.unlink(evdir.next); } catch(e) {}
        prop.deleteChilds(list);

        var curDone = false, nextDone = false;

        for(var i = 0; i < evs.length; i++) {

            var e = evs[i];
            var n = prop.createRoot();

            n.type = 'event';
            var m = {
                title: e.title || '',
                description: e.desc || '',
                start: e.start,
                stop: e.stop
            };
            if(e.realStart) m.realStart = e.realStart;
            if(e.realStop)  m.realStop  = e.realStop;
            if(e.gap)       m.gap       = 1;
            if(e.icon)      m.icon      = e.icon;
            n.metadata = m;
            if(url) n.url = url;

            var isCur = (e.start <= now && e.stop > now);
            if(isCur && !curDone) {
                n.metadata.isCurrent = 1;
                prop.link(n, evdir.current);
                curDone = true;
            } else if(!isCur && !nextDone && e.start > now) {
                n.metadata.isNext = 1;
                prop.link(n, evdir.next);
                nextDone = true;
            }

            prop.setParent(n, list);
        }

        // Celle della griglia EPG: gli eventi
        // vengono tagliati alla finestra guida e i buchi riempiti
        // con celle "No information". Ogni riga somma esattamente
        // GRIDSPAN minuti cosi' le colonne sono allineate.
        var gclist = item.root.metadata.gridcells;
        prop.deleteChilds(gclist);
        var ncells = 0;

        var w0 = Math.floor(now / 1800) * 1800 - 1800;
        var w1 = w0 + gridSpan();
        var t = w0;

        var chxidx = item.root.metadata.xidx;

        function gcell(title, s, e2, iscur, empty, estart, estop) {
            var c = prop.createRoot();
            c.metadata = {
                title: title || '',
                start: s,
                stop: e2,
                // tempi reali del programma (non tagliati alla
                // finestra): servono alla finestra catch-up
                estart: estart || s,
                estop: estop || e2,
                // xidx -1 sulle celle vuote: il sink ignora il
                // catch-up (streams[-1] non esiste)
                xidx: empty ? -1 : chxidx,
                w: Math.max(0.5, (e2 - s) / 60),
                cur: iscur ? 1 : 0,
                empty: empty ? 1 : 0
            };
            prop.setParent(c, gclist);
            ncells++;
        }

        for(var i = 0; i < evs.length; i++) {
            var e = evs[i];
            if(e.stop <= w0 || e.start >= w1) continue;
            var s = Math.max(e.start, w0);
            var e2 = Math.min(e.stop, w1);
            if(s > t) gcell('', t, s, 0, 1);
            gcell(e.title, s, e2, e.start <= now && e.stop > now, 0,
                  e.start, e.stop);
            t = e2;
        }
        if(t < w1) gcell('', t, w1, 0, 1);
        if(cfg.debug)
            console.log('xctv: gridcells ' + item.root.metadata.title +
                        ' = ' + ncells);
    } catch(e) {
        if(cfg.debug) console.log('xctv: setChannelEvents: ' + e);
    }
}


/*
 *  EPG per un item canale: dalla guida XMLTV se caricata,
 *  altrimenti fallback su get_short_epg (solo now/next).
 */
/*
 *  Applica l'offset orario EPG (minuti) a una lista di eventi
 *  copiandola — l'originale resta intatto per altre query.
 */
function shiftEvs(evs) {
    var off = cfg.epgOffsetMin * 60;
    if(!off) return evs;
    var out = [];
    for(var i = 0; i < evs.length; i++) {
        var e = {};
        for(var k in evs[i]) e[k] = evs[i][k];
        e.start += off;
        e.stop += off;
        out.push(e);
    }
    return out;
}

function fillChannelEpg(item, stream, fullday, allowShort) {

    var evs = [];

    if(guideFresh()) {
        var key = stream.epgid || stream.title;
        var now = Math.floor(Date.now() / 1000);
        evs = guide.eventsFor(key, fullday ? now - 6 * 3600 : now - 3600,
                              fullday ? now + 36 * 3600 : now + 6 * 3600);
        if(cfg.debug)
            console.log('xctv: match ' + key + ' -> "' + guide.match(key) + '"');
    } else if(cfg.debug) {
        console.log('xctv: guideFresh=false guide=' + (guide ? 'set' : 'null') +
                    ' fetchedAt=' + guideFetchedAt + ' ttl=' + cfg.epgTtlH);
    }

    if(!evs.length && allowShort !== false) {
        // fetch async per-riga: now/next arriva in ~un RTT per
        // canale, senza aspettare il download della guida intera
        shortEpgQueue(item, stream, fullday);
        return;
    }

    evs = shiftEvs(evs);

    if(cfg.debug)
        console.log('xctv: fillChannelEpg ' + stream.title + ' key=' +
                    (stream.epgid || stream.title) + ' evs=' + evs.length);

    if(evs.length)
        setChannelEvents(item, evs);
}


/*
 *  Coda bounded di get_short_epg async — max 4 in volo (il pool
 *  HTTP ne gestisce 2 per host, il resto resta in coda). I
 *  risultati restano in shortCache 10 minuti: cambiando gruppo e
 *  tornando indietro le righe si ripopolano senza nuove request.
 */
var shortQ = [];
var shortInFlight = 0;
var shortCache = {};
var shortReq = {};
var SHORT_MAX = 4;
var SHORT_QCAP = 128;
var SHORT_TTL = 600;

function shortEpgQueue(item, stream, fullday) {

    var u = stream.source ? stream.source.url : stream.id;
    var c = shortCache[u];
    if(c) {
        if(c.t > Math.floor(Date.now() / 1000) - SHORT_TTL && c.evs.length) {
            setChannelEvents(item, shiftEvs(c.evs));
            return;
        }
        delete shortCache[u];
    }
    if(shortReq[u]) return;
    if(shortQ.length >= SHORT_QCAP) return;
    shortReq[u] = true;

    shortQ.push({ item: item, stream: stream, fullday: fullday });
    shortEpgKick();
}

function shortEpgKick() {

    while(shortInFlight < SHORT_MAX && shortQ.length) {

        var job = shortQ.shift();
        shortInFlight++;

        api().getShortEpgAsync(job.stream.id,
            job.fullday ? 48 : 6,
            function(evs) {

                shortInFlight--;
                var u = job.stream.source ? job.stream.source.url :
                        job.stream.id;
                delete shortReq[u];
                if(evs && evs.length)
                    shortCache[u] = { evs: evs,
                                      t: Math.floor(Date.now() / 1000) };
                try {
                    if(!prop.isZombie(job.item.root)) {
                        // se la guida e' arrivata nel frattempo
                        // preferisce quella (copertura completa)
                        var g = guideFresh() ? guide : null;
                        var ge = [];
                        if(g) {
                            var now = Math.floor(Date.now() / 1000);
                            var key = job.stream.epgid || job.stream.title;
                            ge = g.eventsFor(key,
                                job.fullday ? now - 6 * 3600 : now - 3600,
                                job.fullday ? now + 36 * 3600 : now + 6 * 3600);
                        }
                        var out = ge.length ? ge : (evs || []);
                        if(out.length)
                            setChannelEvents(job.item, shiftEvs(out));
                    }
                } catch(e) {}
                shortEpgKick();
            });
    }
}


/*
 *  Popola l'EPG di tutti gli item di una pagina canali.
 *  streams[i] corrisponde a items[i] (stesso ordine di append).
 *  Senza guida XMLTV il fallback get_short_epg e' limitato ai
 *  primi canali per non fare centinaia di richieste HTTP.
 */
/*
 *  Senza guida XMLTV, per ogni canale si accoda una richiesta
 *  get_short_epg — su chunk da 160-240 righe erano ~128 HTTP +
 *  migliaia di prop-op a ogni cambio gruppo, ed e' quello che
 *  rendeva i click successivi lentissimi (thread ES saturo).
 *  TiviMate/OttPlayer mostrano l'EPG solo delle righe visibili:
 *  qui si riempiono subito i primi SHORT_INIT canali del chunk,
 *  il resto arriva via selectchild quando la riga prende focus
 *  (fillFocusedEpg in hookZap).
 */
var SHORT_INIT = 16;

function fillPageEpg(items, streams, fullday) {

    ensureGuide(function(ok) {

        var hasGuide = guideFresh();
        var n = 0;
        for(var i = 0; i < items.length; i++) {
            try {
                if(prop.isZombie(items[i].root)) return;
                if(!hasGuide && n >= SHORT_INIT) break;
                // con guida pronta e' lookup in memoria; senza
                // guida fillChannelEpg accoda get_short_epg async
                fillChannelEpg(items[i], streams[i], fullday, true);
                n++;
            } catch(e) {}
        }
    });
}


/*
 *  fillLiveGroups — popola page.model.groups con i nodi delle
 *  categorie live (+ "Preferiti" e "Tutti i canali") per la
 *  colonna gruppi della vista live.
 */
// Chiave stabile di un gruppo per l'ordine salvato
function grpKey(cat) {
    return cat == null ? 'all' : String(cat);
}

function saveGroupOrder(groups) {
    var keys = [];
    for(var i = 0; i < groups.length; i++)
        keys.push(grpKey(groups[i].cat));
    grpOrdStore.list = keys;
}

// categorie live: cache calda o fetch async — cb(cats|false)
function liveCats(cb) {
    var w = cacheGet('livecats');
    if(w) { cb(w); return; }
    var a = api();
    var fin = function(cats) {
        if(cats) cacheSet('livecats', cats);
        cb(cats);
    };
    if(a.getLiveCategoriesAsync) a.getLiveCategoriesAsync(fin);
    else fin(a.getLiveCategories());
}

// liveStreams(cb) — catalogo live via callback: cache-hit
// sincrono, miss -> fetch async (niente HTTP bloccante sul
// thread ES da path secondari: export m3u, catch-up, palinsesto).
function liveStreams(cb) {
    var w = cacheGet('livestreams');
    if(w) { cb(w); return; }
    // disco: sync gia' fatta — niente refetch del catalogo intero
    var disk = catalogFromDisk('live');
    if(disk) { cacheSet('livestreams', disk); cb(disk); return; }
    var a = api();
    var fin = function(l) {
        if(l) { cacheSet('livestreams', l); catalogToDisk('live', l); }
        cb(l);
    };
    // 'Tutti i canali' opt-in o meno, il catalogo intero passa
    // dallo scan per-categoria (bounded) invece che dal fetch
    // unico get_live_streams — vedi wholeByCats
    wholeByCats('live', a, null, fin);
}


/*
 *  liveById — uno stream per id senza materializzare il
 *  catalogo: cache/disco se presente, altrimenti scansione
 *  per-categoria filtrata sull'id (scheda catch-up, palinsesto,
 *  registrazioni). cb(stream|null).
 */
function liveById(id, cb) {

    var w = cacheGet('livestreams');
    if(w) {
        for(var i = 0; i < w.length; i++)
            if(String(w[i].id) == String(id)) { cb(w[i]); return; }
        cb(null); return;
    }

    var scanCat = function(l) {
        if(l)
            for(var i = 0; i < l.length; i++)
                if(String(l[i].id) == String(id)) return l[i];
        return null;
    };

    // indice id->cat su disco (pochi KB): basta una fetch
    // per-categoria — niente parse del catalogo intero ne'
    // scansione di tutte le categorie
    var cat = liveCatIndexLookup(id);
    if(cat != null) {
        var warm = cacheGet('live:' + cat);
        if(warm) { cb(scanCat(warm)); return; }
        var fin = function(l) {
            if(l) cacheSet('live:' + cat, l);
            var s = scanCat(l);
            if(s) { cb(s); return; }
            diskFallback();
        };
        try {
            var a = api();
            if(a.getLiveStreamsByCategoryIdAsync) {
                a.getLiveStreamsByCategoryIdAsync(cat, fin);
                return;
            }
            fin(a.getLiveStreamsByCategoryId(cat));
            return;
        } catch(e) {}
    }
    diskFallback();

    function diskFallback() {
        var w2 = catalogFromDisk('live');
        if(w2) {
            cacheSet('livestreams', w2);
            cb(scanCat(w2)); return;
        }
        wholeByCats('live', api(), {
            limit: 1,
            keep: function(it) { return String(it.id) == String(id); }
        }, function(l) { cb(l && l.length ? l[0] : null); });
    }
}


/*
 *  wholeStreams — catalogo intero vod/series con lo stesso giro
 *  del live: cache in memoria -> disco -> fetch async. I cataloghi
 *  VOD arrivano a 100k+ item: senza il disco ogni apertura di
 *  "Tutti i film"/"Tutte le serie" rifarebbe download+parse da
 *  decine di MB (e sui box da 1GB era l'altro OOM dopo il live).
 */
function wholeStreams(kind, cb) {

    var key = (kind == 'series') ? 'series' : 'vodstreams';
    var w = cacheGet(key);
    if(w) { cb(w); return; }

    var disk = catalogFromDisk(kind);
    if(disk) { cacheSet(key, disk); cb(disk); return; }

    var a = api();
    var fin = function(l) {
        if(l) { cacheSet(key, l); catalogToDisk(kind, l); }
        cb(l);
    };
    // fetch per-categoria: n piccole risposte invece di un unico
    // JSON mostruoso — sui cataloghi da 50k+ il body del fetch
    // totale + l'array mappato sforano la RAM del box anche con
    // lo scan incrementale (misurato 543MB -> kill). Le categorie
    // nascoste non si scaricano nemmeno.
    wholeByCats(kind, a, null, fin);
}


/*
 *  wholeByCats — ricostruisce il catalogo 'all' concatenando le
 *  fetch per-categoria (4 in volo): il provider risponde con
 *  liste piccole che si accumulano gia' slim. Ordine = ordine
 *  categorie (come TiviMate). Dedup per id: gli item
 *  multi-categoria arriverebbero duplicati.
 *
 *  opts.keep(it): filtro durante l'accumulo — usato dalle viste
 *  derivate (Preferiti, ricerca) per tenere solo i match, cosi'
 *  il risultato resta piccolo anche a catalogo enorme.
 *  opts.limit: smette di alimentare la coda a N risultati.
 *  opts.queue: lista esplicita di category_id (senza ->
 *  tutte le categorie visibili del provider).
 */
function wholeByCats(kind, a, opts, cb) {

    opts = opts || {};
    var isLive = (kind == 'live');
    var isSeries = (kind == 'series');
    var catsKey = isLive ? 'livecats' : (isSeries ? 'seriescats' : 'vodcats');
    var CONC = 4;

    var finCats = function(cats) {
        if(!cats || !cats.length) { cb(false); return; }

        // salta del tutto le categorie nascoste/bloccate:
        // non si scaricano e non occupano RAM
        var bm = opts.queue ? {} : blockedCatMap(kind, cats);
        var queue = [];
        if(opts.queue) {
            for(var q = 0; q < opts.queue.length; q++) queue.push(opts.queue[q]);
        } else {
            for(var i = 0; i < cats.length; i++)
                if(cats[i].id != null && cats[i].id !== '' &&
                   !bm[String(cats[i].id)])
                    queue.push(cats[i].id);
        }

        if(!queue.length) { cb([]); return; }

        var out = [], seen = {}, qi = 0, inflight = 0, failed = 0;
        var byCat = isLive ? a.getLiveStreamsByCategoryIdAsync :
                    isSeries ? a.getSeriesByCategoryIdAsync :
                               a.getVodStreamsByCategoryIdAsync;
        if(!byCat) { cb(false); return; }

        function step() {
            while(inflight < CONC && qi < queue.length &&
                  !(opts.limit && out.length >= opts.limit)) {
                var cid = queue[qi++];
                inflight++;
                byCat.call(a, cid, function(l) {
                    inflight--;
                    if(l) {
                        for(var j = 0; j < l.length; j++) {
                            var it = l[j];
                            if(seen[it.id]) continue;
                            if(opts.keep && !opts.keep(it)) continue;
                            seen[it.id] = 1;
                            out.push(it);
                        }
                    } else {
                        failed++;
                    }
                    if(qi < queue.length &&
                       !(opts.limit && out.length >= opts.limit)) {
                        step(); return;
                    }
                    if(inflight == 0)
                        cb(out.length || failed < queue.length ? out : false);
                });
            }
        }
        step();
    };

    var warm = cacheGet(catsKey);
    if(warm) { finCats(warm); return; }
    try {
        if(isLive) {
            if(a.getLiveCategoriesAsync)
                a.getLiveCategoriesAsync(function(c) {
                    if(c) cacheSet(catsKey, c); finCats(c); });
            else finCats(a.getLiveCategories());
        } else if(isSeries) {
            if(a.getSeriesCategoriesAsync)
                a.getSeriesCategoriesAsync(function(c) {
                    if(c) cacheSet(catsKey, c); finCats(c); });
            else finCats(a.getSeriesCategories());
        } else {
            if(a.getVodCategoriesAsync)
                a.getVodCategoriesAsync(function(c) {
                    if(c) cacheSet(catsKey, c); finCats(c); });
            else finCats(a.getVodCategories());
        }
    } catch(e) { finCats(false); }
}


function fillLiveGroups(page, groups, activeCat, cats) {

    // abort dei railFill pendenti PRIMA di tutto: un chunk di
    // una fill vecchia creerebbe nodi fantasma dopo la refill
    var gen = (page.__railGen = (page.__railGen || 0) + 1);

    // teardown incrementale del rail: prop.deleteChilds era un
    // blocco sincrono (freeze al refill) — i root vecchi muoiono
    // a slice in background. __railNodes traccia tutti i nodi
    // creati (anche dai chunk tardivi): riferimenti, non nomi.
    killRootsIncr(page, page.__railNodes);
    page.__railNodes = [];

    // groups: array condiviso hookZap <-> liveLoader, mutato in
    // place — una refill async (categorie arrivate dopo)
    // riempie lo stesso oggetto e resta visibile a entrambi
    groups.length = 0;
    groups.push({ cat: 'fav', title: tr('Preferiti') });

    // "Recenti": ultimi canali visti (cronologia kind='live')
    var hist = histStore.list || [];
    var hasRecent = false;
    for(var hi = 0; hi < hist.length; hi++)
        if(hist[hi].k == 'live') { hasRecent = true; break; }
    if(hasRecent)
        groups.push({ cat: 'recent', title: tr('Recenti') });

    // "Tutti i canali" materializza il catalogo intero: opt-in
    // via Impostazioni (rischio OOM su liste grandi)
    if(cfg.showAll)
        groups.push({ cat: null, title: tr('Tutti i canali') });

    if(cats)
        for(var i = 0; i < cats.length; i++) {
            if(isHiddenGroup(cats[i].id)) continue;
            groups.push({ cat: cats[i].id, title: cats[i].title });
        }

    // ordine manuale dei gruppi (grpOrdStore.list = chiavi salvate)
    var gkeys = grpOrdStore.list;
    if(gkeys && gkeys.length) {
        var rank = {};
        for(var ri = 0; ri < gkeys.length; ri++) rank[gkeys[ri]] = ri;
        var dec = [];
        for(var di = 0; di < groups.length; di++)
            dec.push({ g: groups[di], i: di });
        dec.sort(function(a, b) {
            var ra = rank[grpKey(a.g.cat)];
            var rb = rank[grpKey(b.g.cat)];
            if(ra === undefined) ra = 9999;
            if(rb === undefined) rb = 9999;
            return ra != rb ? ra - rb : a.i - b.i;
        });
        var sorted = [];
        for(var si = 0; si < dec.length; si++) sorted.push(dec[si].g);
        groups = sorted;
    }

    // nodi del rail creati a rate: con centinaia di categorie il
    // ciclo completo (createRoot + setParent + clone della view)
    // teneva il thread ES impegnato secondi all'apertura. I primi
    // RAIL_INIT compaiono subito, il resto arriva via setTimeout.
    // page.__railCat tiene la categoria corrente: un nodo tardivo
    // eredita il sel giusto anche se il click e' gia' avvenuto.
    // page.__railGen (gia' incrementato in cima) invalida i
    // chunk di una fill precedente.
    page.__railCat = activeCat;
    var mkNode = function(i) {
        var n = prop.createRoot();
        n.metadata.title = groups[i].title;
        // gli pseudo-gruppi (Preferiti/Recenti/Tutti) non si
        // nascondono — solo le categorie del provider
        n.metadata.canhide = (groups[i].cat != 'fav' &&
            groups[i].cat != 'recent' && groups[i].cat !== null) ? 1 : 0;
        n.xidx = i;
        n.sel = (groups[i].cat == page.__railCat) ? 1 : 0;
        groups[i].node = n;
        page.__railNodes.push(n);
        prop.setParent(n, page.model.groups);
    };
    var RAIL_INIT = 48;
    var ni = 0;
    var ne = Math.min(RAIL_INIT, groups.length);
    for(; ni < ne; ni++) mkNode(ni);
    if(ni < groups.length) {
        var railFill = function() {
            if(page.__railGen != gen || prop.isZombie(page.root))
                return;
            var e2 = Math.min(ni + 64, groups.length);
            for(; ni < e2; ni++) mkNode(ni);
            if(ni < groups.length)
                setTimeout(railFill, 0);
        };
        setTimeout(railFill, 0);
    }
    return groups;
}


/*
 *  fillAppMenu — drawer principale  in
 *  page.model.menu: le sezioni dell'app (Guida TV, Film,
 *  Serie TV, Cerca, Impostazioni). Ogni nodo ha url + icona.
 */
function fillAppMenu(page, current) {

    var items = [
        { key: 'live',     title: tr('Guida TV'),      icon: 'skin://icons/ic_tv_48px.svg',
          url: plugin.id + ':alllivestreams:Diretta' },
        { key: 'mv',       title: tr('Multi-view'),    icon: 'skin://icons/ic_videocam_48px.svg',
          url: plugin.id + ':multiview' },
        { key: 'vod',      title: tr('Film'),          icon: 'skin://icons/ic_movie_48px.svg',
          url: plugin.id + ':vodbrowse:Film:all' },
        { key: 'series',   title: tr('Serie TV'),      icon: 'skin://icons/ic_local_movies_48px.svg',
          url: plugin.id + ':seriesbrowse:Serie TV:all' },
        { key: 'search',   title: tr('Cerca'),         icon: 'skin://icons/ic_search_48px.svg',
          url: plugin.id + ':searchui:' },
        { key: 'recs',     title: tr('Registrazioni'), icon: 'skin://icons/ic_alarm_48px.svg',
          url: plugin.id + ':recs' },
        { key: 'help',     title: tr('Guida'),         icon: 'skin://icons/ic_help_48px.svg',
          url: plugin.id + ':help' },
        { key: 'settings', title: tr('Impostazioni'),  icon: 'skin://icons/ic_settings_48px.svg',
          url: plugin.id + ':settings' }
    ];

    // Sezione corrente: niente URL (la voce chiude solo il drawer,
    // non riapre la pagina su cui siamo gia').
    prop.deleteChilds(page.model.menu);
    for(var i = 0; i < items.length; i++) {
        var n = prop.createRoot();
        n.metadata = { title: items[i].title, icon: items[i].icon };
        n.url = (items[i].key == current) ? '' : items[i].url;
        n.xidx = i;
        prop.setParent(n, page.model.menu);
    }
}


/*
 *  ============================================================
 *  Impostazioni in-app 
 *  ============================================================
 *  Pagina con rail sezioni a sinistra (model.groups) e opzioni
 *  a destra (model.nodes). Ogni riga ha metadata:
 *    { title, value, kind, hint }
 *  kind: 'text' | 'choice' | 'bool' | 'action' | 'info' | 'pin'
 *  L'activate arriva su model.eventSink come 'opt:<id>'.
 */

function optRow(page, meta) {

    var n = prop.createRoot();
    n.metadata = meta;
    prop.setParent(n, page.model.nodes);
    return n;
}


/*
 *  editText — chiede un valore testuale via dialog e lo
 *  applica a setProp.model.value (persiste + aggiorna cfg).
 *  Ritorna il nuovo valore da mostrare nella riga.
 */
function editText(caption, setProp, cfgKey, mask) {

    var r = popup.textDialog(caption, true, true);
    if(r.rejected) return null;
    var v = (r.input == null) ? '' : String(r.input);
    // subscribeValue e' asincrono (courier): aggiorno cfg
    // subito e il model.value persiste via callback.
    cfg[cfgKey] = v;
    setProp.model.value = v;
    return mask ? (v ? '••••••' : '') : v;
}


/*
 *  setMultiOptVal — imposta il valore di un multiopt delle
 *  impostazioni native. createMultiOpt non ritorna un handle:
 *  il model va cercato per nome dentro settings.nodes.
 */
function setMultiOptVal(id, v) {
    try {
        var m = prop.getChild(settings.nodes, String(id));
        var opt = prop.getChild(prop.getChild(m, 'options'), String(v));
        prop.select(prop.makeProp(opt));
    } catch(e) {
        if(cfg.debug)
            console.log('xctv: setMultiOptVal ' + id + ': ' + e);
    }
}


/*
 *  cycleValue — cicla un multiopt/int tra valori predefiniti
 *  (: OK cambia il valore). I multiopt non
 *  reagiscono a model.value: vanno selezionati con
 *  prop.select() sul figlio di options.
 *  Ritorna il valore mostrato.
 */
function cycleValue(setProp, cfgKey, values, labels, cur, multiopt) {

    var i = 0;
    for(var k = 0; k < values.length; k++)
        if(String(values[k]) == String(cur)) i = k;
    i = (i + 1) % values.length;
    cfg[cfgKey] = values[i];
    if(multiopt)
        setMultiOptVal(cfgKey, values[i]);
    else
        setProp.model.value = values[i];
    return labels ? labels[i] : String(values[i]);
}


/*
 *  fillSettings — opzioni della sezione `sec` in model.nodes.
 *  I nodi restano vivi fra i refresh (riuso via mappa id->node).
 *  fresh=true (navigazione utente) resetta settingsTried: i fetch
 *  async si ritentano entrando di nuovo nella sezione, MAI in loop
 *  dentro la stessa vista (un cb(false) farebbe refill->miss->
 *  refetch->refill all'infinito = freeze/ANR su Android).
 */
var settingsTried = {};

function fillSettings(page, sec, nodes, fresh) {

    prop.deleteChilds(page.model.nodes);
    for(var id in nodes) delete nodes[id];
    nodes.__sec = sec;
    if(fresh) settingsTried = {};

    function add(meta) {
        var n = optRow(page, meta);
        nodes[meta.id] = n;
    }

    switch(sec) {

    case 'playlist':

        var pll = plList();
        if(pll.length)
            add({ id: 'selpl', kind: 'choice',
                  title: tr('Playlist attiva'),
                  value: ((plStore.active || 0) + 1) + '/' + pll.length +
                         ' — ' + cfg.playName,
                  hint: tr('OK passa alla playlist successiva') });

        add({ id: 'playName', kind: 'text',
              title: tr('Nome playlist'), value: cfg.playName,
              hint: tr('Nome mostrato nel menu') });

        add({ id: 'server', kind: 'text',
              title: tr('Server'), value: cfg.server,
              hint: tr('host:porta o URL Xtream Codes') });

        add({ id: 'username', kind: 'text',
              title: tr('Username'), value: cfg.username });

        add({ id: 'password', kind: 'text', mask: true,
              title: tr('Password'), value: cfg.password ? '••••••' : '' });

        add({ id: 'epgUrl', kind: 'text',
              title: tr('URL EPG'), value: cfg.epgUrl,
              hint: tr('Lascia vuoto per usare la guida del server') });

        add({ id: 'pltype', kind: 'choice',
              title: tr('Tipo playlist'),
              value: ({xtream:'Xtream Codes', m3u:'M3U', stalker:'Stalker'})[cfg.plType],
              hint: tr('Cambia solo per la nuova playlist (Aggiungi)') });

        add({ id: 'refreshMin', kind: 'choice',
              title: tr('Refresh automatico playlist'),
              value: cfg.refreshMin ? cfg.refreshMin + ' min' : 'Mai',
              hint: tr('Ricarica liste e guida a intervalli regolari') });

        add({ id: 'verify', kind: 'action',
              title: tr('Verifica connessione') });

        add({ id: 'addpl', kind: 'action',
              title: tr('Aggiungi playlist…') });

        add({ id: 'editpl', kind: 'action',
              title: tr('Modifica playlist attiva…') });

        add({ id: 'delpl', kind: 'action',
              title: tr('Rimuovi playlist attiva') });
        break;

    case 'epg':

        add({ id: 'epg', kind: 'bool',
              title: tr('Guida TV (EPG)'), value: cfg.epg });

        add({ id: 'epgUrl', kind: 'text',
              title: tr('URL XMLTV personalizzato'), value: cfg.epgUrl,
              hint: tr('Vuoto = xmltv.php del server Xtream') });

        add({ id: 'epgTtlH', kind: 'choice',
              title: tr('Aggiorna EPG ogni'), value: cfg.epgTtlH + ' ' + tr('ore'),
              hint: tr('Intervallo di refresh della guida') });

        add({ id: 'epgOnStart', kind: 'bool',
              title: tr('Aggiorna EPG all\'avvio'), value: cfg.epgOnStart });

        add({ id: 'epgOffsetMin', kind: 'choice',
              title: tr('Correggi orario EPG'),
              value: (cfg.epgOffsetMin > 0 ? '+' : '') + cfg.epgOffsetMin + ' min',
              hint: tr('Shift dei programmi se la guida e\' sfasata') });

        add({ id: 'reloadEpg', kind: 'action',
              title: tr('Ricarica EPG adesso') });
        break;

    case 'playback':

        add({ id: 'liveExt', kind: 'choice',
              title: tr('Formato stream live'),
              value: ({auto:'Automatico', m3u8:'HLS (m3u8)', ts:'MPEG-TS'})[cfg.liveExt] });

        add({ id: 'vodExt', kind: 'choice',
              title: tr('Formato film / episodi'),
              value: ({auto:'Automatico', mkv:'MKV', mp4:'MP4', avi:'AVI'})[cfg.vodExt] });

        add({ id: 'infoSecs', kind: 'choice',
              title: tr('Durata info canale'),
              value: cfg.infoSecs == 0 ? tr('Sempre visibile') : cfg.infoSecs + ' s',
              hint: tr('Tempo di visibilita\' del pannello dopo lo zap') });

        add({ id: 'lastChan', kind: 'bool',
              title: tr('Riprendi ultimo canale'),
              value: cfg.lastChan,
              hint: tr('All\'avvio la guida si apre sull\'ultimo canale visto') });

        add({ id: 'userAgent', kind: 'text',
              title: tr('User-Agent'),
              value: cfg.userAgent || tr('Movian (predefinito)'),
              hint: tr('UA custom per API e stream sul server') });

        add({ id: 'headers', kind: 'text',
              title: tr('Header HTTP extra'),
              value: cfg.headers ? cfg.headers.split(/\r?\n/).length + ' ' + tr('attivi') : tr('Nessuno'),
              hint: tr('Uno per riga: "Nome: valore" — vale per API e guida') });

        add({ id: 'autoplayNext', kind: 'bool',
              title: tr('Autoplay episodio successivo'),
              value: cfg.autoplayNext,
              hint: tr('A fine episodio parte automaticamente il successivo') });

        add({ id: 'recDir', kind: 'text',
              title: tr('Cartella registrazioni'),
              value: cfg.recDir || tr('Predefinita'),
              hint: tr('Dove salvare i file .ts — vuoto = storage del plugin') });

        add({ id: 'sleepTimer', kind: 'choice',
              title: tr('Sleep timer'),
              value: sleepMin ? sleepMin + ' min' : 'Disattivato',
              hint: tr('Ferma la riproduzione dopo N minuti') });
        break;

    case 'appearance':

        add({ id: 'showNums', kind: 'bool',
              title: tr('Numeri canale'), value: cfg.showNums,
              hint: tr('Numero progressivo nella guida') });

        add({ id: 'showLogos', kind: 'bool',
              title: tr('Loghi canale'), value: cfg.showLogos });

        add({ id: 'sortMode', kind: 'choice',
              title: tr('Ordinamento cataloghi'),
              value: ({default:tr('Predefinito'), name:tr('Nome A-Z'),
                       added:tr('Aggiunti di recente'), rating:tr('Voto')})[cfg.sortMode],
              hint: tr('Ordine dei poster nelle sezioni Film e Serie TV') });

        add({ id: 'gridHours', kind: 'choice',
              title: tr('Ore visibili in guida'),
              value: cfg.gridHours + ' ' + tr('ore'),
              hint: tr('Ampiezza della finestra temporale della griglia EPG') });

        add({ id: 'panelAlpha', kind: 'choice',
              title: tr('Opacita\' pannelli'),
              value: cfg.panelAlpha + '%',
              hint: tr('Trasparenza di guide e menu sul video') });

        add({ id: 'accent', kind: 'choice',
              title: tr('Colore accento'),
              value: ({blue:'Blu', green:'Verde', orange:'Arancione',
                       red:'Rosso', violet:'Viola'})[cfg.accent],
              hint: tr('Colore di indicatori e linea "adesso"') });

        add({ id: 'resetOrder', kind: 'action',
              title: tr('Ripristina ordine e numeri canali'),
              hint: tr('Annulla spostamenti e numerazione personalizzata') });

        add({ id: 'unhideAll', kind: 'action',
              title: tr('Ripristina canali e gruppi nascosti'),
              hint: tr('Mostra di nuovo tutto cio\' che e\' stato nascosto') });
        break;

    case 'parental':

        add({ id: 'pin', kind: 'text',
              title: tr('PIN'), value: cfg.pin ? '••••' : tr('Non impostato'),
              hint: tr('Blocca i gruppi con contenuti per adulti') });

        add({ id: 'pininfo', kind: 'info',
              title: tr('Gruppi bloccati'),
              value: '',
              hint: cfg.pin ?
                  tr('I gruppi "adulti" chiedono il PIN per essere aperti') :
                  tr('Imposta un PIN per attivare il blocco') });

        // Blocco per categoria: live / film / serie — una riga per
        // gruppo con toggle. Richiede comunque il PIN impostato.
        // Le liste arrivano da cache condivisa (livecats/vodcats/
        // seriescats): a cache fredda si scalda in async e la
        // sezione si ri-riempe da sola.
        try {
            var lockm = hidMap(lockStore);
            var catsSecs = [
                ['live', 'livecats', tr('Gruppo live'),
                 function(cb) { liveCats(cb); }],
                ['vod', 'vodcats', tr('Categoria film'),
                 function(cb) {
                    var a = api();
                    if(a.getVodCategoriesAsync) a.getVodCategoriesAsync(cb);
                    else cb(a.getVodCategories());
                 }],
                ['series', 'seriescats', tr('Categoria serie'),
                 function(cb) {
                    var a = api();
                    if(a.getSeriesCategoriesAsync) a.getSeriesCategoriesAsync(cb);
                    else cb(a.getSeriesCategories());
                 }]
            ];
            var missing = 0;
            for(var si = 0; si < catsSecs.length; si++) {
                var lcats = cacheGet(catsSecs[si][1]);
                if(!lcats) {
                    // un solo fetch per chiave per visita: su
                    // fallimento il refill mostra la sezione senza
                    // categorie invece di rilanciare la request
                    if(!settingsTried[catsSecs[si][1]]) {
                        settingsTried[catsSecs[si][1]] = 1;
                        missing++;
                        (function(cs) {
                            cs[3](function(cats) {
                                if(cats) cacheSet(cs[1], cats);
                                // ri-riempi solo se la sezione e'
                                // ancora quella genitori
                                try {
                                    if(!prop.isZombie(page.root) &&
                                       nodes.__sec == 'parental')
                                        fillSettings(page, 'parental', nodes);
                                } catch(e2) {}
                            });
                        })(catsSecs[si]);
                    }
                    continue;
                }
                for(var ci = 0; ci < lcats.length; ci++) {
                    var key = catsSecs[si][0] + ':' + lcats[ci].id;
                    add({ id: 'lockcat:' + key, kind: 'bool',
                          title: tr('Blocca') + ': ' + lcats[ci].title,
                          value: !!lockm[key],
                          hint: catsSecs[si][2] });
                }
            }
            if(missing)
                add({ id: 'lockwait', kind: 'info',
                      title: tr('Caricamento gruppi…'),
                      value: '', hint: tr('La lista arriva a breve') });
        } catch(e) {}
        break;

    case 'sistema':

        add({ id: 'backup', kind: 'action',
              title: tr('Esporta backup'),
              hint: tr('Salva impostazioni, preferiti e liste in') + ' ' + BACKUP_PATH });

        add({ id: 'restore', kind: 'action',
              title: tr('Ripristina backup'),
              hint: tr('Carica impostazioni e liste dal file di backup') });

        add({ id: 'exportFav', kind: 'action',
              title: tr('Esporta preferiti in M3U'),
              hint: tr('Salva i canali preferiti come playlist standard') });
        break;

    case 'info':

        var user = infoStoreCache.user || null;
        if(!user && !settingsTried.info) {
            settingsTried.info = 1;
            // fetch async + ri-riempi se la sezione e' ancora info
            try {
                var a0 = api();
                if(a0.getInfoAsync)
                    a0.getInfoAsync('user', function(u) {
                        if(u) infoStoreCache.user = u;
                        try {
                            if(!prop.isZombie(page.root) &&
                               nodes.__sec == 'info')
                                fillSettings(page, 'info', nodes);
                        } catch(e2) {}
                    });
            } catch(e0) {}
        }

        add({ id: 'i_ver', kind: 'info', title: tr('Versione'),
              value: tr('XCtv') + ' ' + plugin.version });

        add({ id: 'i_acc', kind: 'info', title: tr('Account'),
              value: user && user.username ? String(user.username) : '—' });

        add({ id: 'i_st', kind: 'info', title: tr('Stato'),
              value: user && user.status ? String(user.status) : '—' });

        if(user && user.exp_date) {
            var d = new Date(parseInt(user.exp_date, 10) * 1000);
            add({ id: 'i_exp', kind: 'info', title: tr('Scadenza'),
                  value: d.toISOString().substring(0, 10) });
        }

        if(user && user.max_connections)
            add({ id: 'i_conn', kind: 'info', title: tr('Connessioni max'),
                  value: String(user.max_connections) });

        add({ id: 'i_srv', kind: 'info', title: tr('Server'),
              value: cfg.server || '—' });

        add({ id: 'movianset', kind: 'action',
              title: tr('Impostazioni Movian…'),
              hint: tr('Pagina impostazioni nativa del plugin') });
        break;
    }
}


/*
 *  handleSetting — esegue l'opzione `id` sulla pagina.
 *  Aggiorna il valore mostrato nella riga se cambia.
 */
function handleSetting(page, id, nodes) {

    function refresh(id, val) {
        if(nodes[id]) nodes[id].metadata.value = val;
    }

    // toggle blocco categoria (PIN per categoria)
    if(id.indexOf('lockcat:') == 0) {
        var lk = id.substr(8);
        hidSet(lockStore, lk, hidMap(lockStore)[lk] ? 0 : 1);
        refresh(id, !!hidMap(lockStore)[lk]);
        return;
    }

    switch(id) {

    case 'playName':
        var v = editText(tr('Nome playlist:'), setName, 'playName');
        if(v != null) refresh(id, v);
        break;
    case 'server':
        var v = editText(tr('Server (host:porta o URL):'), setServer, 'server');
        if(v != null) { refresh(id, v); resetSession(); }
        break;
    case 'username':
        var v = editText(tr('Username:'), setUser, 'username');
        if(v != null) { refresh(id, v); resetSession(); }
        break;
    case 'password':
        var v = editText(tr('Password:'), setPass, 'password', true);
        if(v != null) { refresh(id, v ? '••••••' : ''); resetSession(); }
        break;
    case 'epgUrl':
        var v = editText(tr('URL EPG (vuoto = server Xtream):'), setEpgUrl, 'epgUrl');
        if(v != null) refresh(id, v);
        break;

    case 'epg':
        cfg.epg = !cfg.epg;
        setEpg.model.value = cfg.epg;
        refresh(id, cfg.epg);
        break;
    case 'epgTtlH':
        refresh(id, cycleValue(setEpgTtl, 'epgTtlH',
                [1, 4, 8, 12, 24, 48], null, cfg.epgTtlH) + ' ' + tr('ore'));
        break;
    case 'epgOnStart':
        cfg.epgOnStart = !cfg.epgOnStart;
        setEpgOnStart.model.value = cfg.epgOnStart;
        refresh(id, cfg.epgOnStart);
        break;
    case 'epgOffsetMin':
        var v2 = cycleValue(setEpgOffset, 'epgOffsetMin',
                            [-720,-360,-180,-120,-90,-60,-30,0,30,60,90,120,180,360,720],
                            null, cfg.epgOffsetMin);
        refresh(id, (parseInt(v2) > 0 ? '+' : '') + v2 + ' min');
        break;
    case 'reloadEpg':
        guideFetchedAt = 0;
        guide = null;
        popup.notify(tr('EPG: ricarico in corso…'), 3);
        ensureGuide(function(ok) {
            popup.notify(ok ? tr('EPG aggiornata') : tr('EPG non disponibile'), 3);
        });
        break;

    case 'liveExt':
        refresh(id, cycleValue(setLiveExt, 'liveExt', ['auto', 'm3u8', 'ts'],
                ['Automatico', 'HLS (m3u8)', 'MPEG-TS'], cfg.liveExt, true));
        break;
    case 'vodExt':
        refresh(id, cycleValue(setVodExt, 'vodExt', ['auto', 'mkv', 'mp4', 'avi'],
                ['Automatico', 'MKV', 'MP4', 'AVI'], cfg.vodExt, true));
        break;
    case 'infoSecs':
        var v = cycleValue(setInfoSecs, 'infoSecs',
                           [0, 3, 5, 10, 15, 30], null, cfg.infoSecs);
        refresh(id, v == '0' ? tr('Sempre visibile') : v + ' s');
        break;
    case 'lastChan':
        cfg.lastChan = !cfg.lastChan;
        setLastChan.model.value = cfg.lastChan;
        refresh(id, cfg.lastChan);
        break;
    case 'sleepTimer':
        var sv = [0, 15, 30, 60, 90, 120];
        var si2 = 0;
        for(var sk2 = 0; sk2 < sv.length; sk2++)
            if(sv[sk2] == sleepMin) si2 = sk2;
        armSleep(sv[(si2 + 1) % sv.length]);
        refresh(id, sleepMin ? sleepMin + ' min' : 'Disattivato');
        break;

    case 'showNums':
        cfg.showNums = !cfg.showNums;
        setShowNums.model.value = cfg.showNums;
        refresh(id, cfg.showNums);
        break;
    case 'showLogos':
        cfg.showLogos = !cfg.showLogos;
        setShowLogos.model.value = cfg.showLogos;
        refresh(id, cfg.showLogos);
        break;
    case 'sortMode':
        refresh(id, cycleValue(setSort, 'sortMode',
                ['default', 'name', 'added', 'rating'],
                ['Predefinito', 'Nome A-Z', 'Aggiunti di recente', 'Voto'],
                cfg.sortMode, true));
        break;
    case 'unhideAll':
        var n2 = Object.keys(hidMap(hidChanStore)).length +
                 Object.keys(hidMap(hidGroupStore)).length +
                 Object.keys(hidMap(hidBrowseGrpStore)).length +
                 Object.keys(hidMap(hidItemStore)).length;
        hidChanStore.map = {};
        hidGroupStore.map = {};
        hidBrowseGrpStore.map = {};
        hidItemStore.map = {};
        popup.notify(n2 ? tr('Ripristinati') + ' ' + n2 + ' ' + tr('elementi') : tr('Nulla da ripristinare'), 3);
        break;

    case 'pin':
        var r = popup.textDialog(tr('PIN (vuoto = disattivo)') + ': ', true, true);
        if(r.rejected) break;
        var v = (r.input == null) ? '' : String(r.input);
        cfg.pin = v;
        setPin.model.value = v;
        refresh('pin', v ? '••••' : tr('Non impostato'));
        refresh('pininfo', '');
        if(nodes['pininfo'])
            nodes['pininfo'].metadata.hint = cfg.pin ?
                'I gruppi "adulti" chiedono il PIN per essere aperti' :
                'Imposta un PIN per attivare il blocco';
        break;

    case 'verify':
        var vx = makeXtream();
        if(vx.checkLoginAsync) {
            popup.notify(tr('Verifica in corso…'), 2);
            vx.checkLoginAsync(function(res) {
                popup.notify(res.status ? tr('Connessione OK') :
                    (tr('Errore') + ': ' + res.error), 4);
            });
        } else {
            var res = vx.checkLogin();
            popup.notify(res.status ? tr('Connessione OK') : (tr('Errore') + ': ' + res.error), 4);
        }
        break;

    case 'pltype':
        var pt = ['xtream', 'm3u', 'stalker'];
        var pl2 = plList().slice();
        var ai3 = plStore.active || 0;
        if(ai3 < pl2.length) {
            var cur3 = pl2[ai3].t || 'xtream';
            var nxt3 = pt[(pt.indexOf(cur3) + 1) % pt.length];
            pl2[ai3].t = nxt3;
            plStore.list = pl2;
            cfg.plType = nxt3;
            resetSession();
            refresh(id, ({xtream:'Xtream Codes', m3u:'M3U', stalker:'Stalker'})[nxt3]);
            popup.notify(tr('Tipo playlist') + ': ' + nxt3 + ' ' + tr('(riapri il plugin)'), 3);
        }
        break;

    case 'refreshMin':
        var rv = [0, 15, 30, 60, 120, 240, 720];
        var ri3 = 0;
        for(var rk = 0; rk < rv.length; rk++)
            if(rv[rk] == cfg.refreshMin) ri3 = rk;
        cfg.refreshMin = rv[(ri3 + 1) % rv.length];
        setRefreshMin.model.value = cfg.refreshMin;
        armAutoRefresh();
        refresh(id, cfg.refreshMin ? cfg.refreshMin + ' min' : 'Mai');
        break;

    case 'userAgent':
        var v = editText(tr('User-Agent (vuoto = Movian):'), setUA, 'userAgent');
        if(v != null) {
            applyNetTuning();
            resetSession();
            refresh(id, v || tr('Movian (predefinito)'));
        }
        break;

    case 'headers':
        var v = editText(tr('Header extra (Nome: valore, uno per riga):'),
                         setHeaders, 'headers');
        if(v != null) {
            resetSession();
            refresh(id, v ? v.split(/\r?\n/).length + ' ' + tr('attivi') : tr('Nessuno'));
        }
        break;

    case 'autoplayNext':
        cfg.autoplayNext = !cfg.autoplayNext;
        setAutoplayNext.model.value = cfg.autoplayNext;
        refresh(id, cfg.autoplayNext);
        break;

    case 'recDir':
        var v = editText(tr('Cartella registrazioni (vuoto = predefinita):'),
                         setRecDir, 'recDir');
        if(v != null) {
            // verifica subito la scrivibilita'
            if(v) {
                try { require('native/fs').mkdirs(v, 0); }
                catch(er) {
                    popup.notify(tr('Cartella non scrivibile') + ': ' + er, 4);
                }
            }
            refresh(id, v || tr('Predefinita'));
        }
        break;

    case 'exportFav':
        exportFavoritesM3U();
        break;

    case 'gridHours':
        refresh(id, cycleValue(setGridHours, 'gridHours',
                [2, 3, 4, 5, 6, 8], null, cfg.gridHours) + ' ' + tr('ore'));
        break;

    case 'panelAlpha':
        refresh(id, cycleValue(setPanelAlpha, 'panelAlpha',
                [30, 45, 60, 70, 80, 85, 90, 95, 100], null, cfg.panelAlpha) + '%');
        break;

    case 'accent':
        refresh(id, cycleValue(setAccent, 'accent',
                ['blue', 'green', 'orange', 'red', 'violet'],
                ['Blu', 'Verde', 'Arancione', 'Rosso', 'Viola'],
                cfg.accent, true));
        break;

    case 'resetOrder':
        ordStore.map = {};
        numStore.map = {};
        popup.notify(tr('Ordine e numerazione ripristinati'), 2);
        break;

    case 'selpl':
        var pll2 = plList();
        if(pll2.length > 1) {
            applyPlaylist(((plStore.active || 0) + 1) % pll2.length);
            fillSettings(page, 'playlist', nodes);
            popup.notify(tr('Playlist attiva') + ': ' + cfg.playName, 2);
        }
        break;

    case 'addpl':
        page.redirect(plugin.id + ':addplaylist');
        break;

    case 'editpl':
        page.redirect(plugin.id + ':addplaylist:' + (plStore.active || 0));
        break;

    case 'delpl':
        var pl3 = plList().slice();
        var ai = plStore.active || 0;
        if(ai < pl3.length) pl3.splice(ai, 1);
        plStore.list = pl3;
        if(pl3.length) {
            applyPlaylist(Math.min(ai, pl3.length - 1));
            fillSettings(page, 'playlist', nodes);
            popup.notify(tr('Playlist rimossa'), 2);
        } else {
            plStore.active = 0;
            cfg.server = cfg.username = cfg.password = '';
            setServer.model.value = '';
            setUser.model.value = '';
            setPass.model.value = '';
            resetSession();
            page.redirect(plugin.id + ':start');
        }
        break;

    case 'movianset':
        if(settingsUrl) page.redirect(settingsUrl);
        break;

    case 'backup':
        backupNow();
        break;
    case 'restore':
        restoreNow();
        break;
    }
}


/*
 *  hookSettingsPage — rail sezioni + eventSink 'opt:'/'group:'.
 */
function hookSettingsPage(page, sections, initial) {

    var nodes = {};
    var groups = [];

    prop.deleteChilds(page.model.groups);
    for(var i = 0; i < sections.length; i++) {
        var n = prop.createRoot();
        n.metadata = { title: sections[i].title };
        n.xidx = i;
        n.sel = (i == initial) ? 1 : 0;
        prop.setParent(n, page.model.groups);
        groups.push({ id: sections[i].id, node: n });
    }

    function load(idx) {
        for(var g = 0; g < groups.length; g++)
            groups[g].node.sel = (g == idx) ? 1 : 0;
        fillSettings(page, groups[idx].id, nodes, true);
    }

    prop.subscribe(page.model.eventSink, function(type, val) {
        try {
            if(type != 'action' || prop.isZombie(page.root)) return;
            if(val.indexOf('opt:') == 0) {
                handleSetting(page, val.substr(4), nodes);
            } else if(val.indexOf('group:') == 0) {
                load(parseInt(val.substr(6), 10));
            }
        } catch(e) {
            console.log('xctv: settings handler: ' + e);
        }
    }, {
        autoDestroy: true,
    });

    load(initial);
}


/*
 *  pinLocked — il gruppo richiede PIN (nome da contenuto
 *  adulto) quando il PIN e' impostato.
 */
function pinLocked(title) {
    return cfg.pin && title && ADULT_GROUP_RE.test(title);
}


function checkPin() {
    var r = popup.textDialog(tr('Inserisci il PIN') + ': ', true, true);
    if(r.rejected) return false;
    if(String(r.input) == String(cfg.pin)) return true;
    popup.notify(tr('PIN errato'), 2);
    return false;
}


var ADULT_GROUP_RE = /adult|xxx|18\+|sexy|porn|erotic|hustler|playboy|penthouse|adulti|eros\b|\bhot\b/i;



/*
 *  setGuideRuler — riga oraria della griglia EPG: uno slot
 *  ogni 30 minuti con label + peso (larghezza proporzionale),
 *  piu' gridstart/nowoff usati dalla view per data e now-line.
 */
function setGuideRuler(page) {

    var now = Math.floor(Date.now() / 1000);
    var w0 = Math.floor(now / 1800) * 1800 - 1800;

    page.model.gridstart = w0;
    page.model.gridspan = GRIDSPAN / 60;
    page.model.nowoff = (now - w0) / 60;

    prop.deleteChilds(page.model.gridslots);
    var cnt = 0;
    for(var t = w0; t < w0 + GRIDSPAN; t += 1800) {
        var n = prop.createRoot();
        n.metadata = { start: t, stop: t + 1800, w: 30 };
        prop.setParent(n, page.model.gridslots);
        cnt++;
    }
    if(cfg.debug) console.log('xctv: setGuideRuler slots=' + cnt);
}


/*
 *  applyChanOrder — ordina la lista canali secondo l'ordine
 *  manuale salvato per il gruppo `ordKey` (i canali non presenti
 *  nella lista salvata vanno in coda, nel loro ordine originale).
 */
function applyChanOrder(list, ordKey) {
    var saved = hidMap(ordStore)[ordKey];
    if(!saved || !saved.length) return;
    var pos = {};
    for(var i = 0; i < saved.length; i++) pos[saved[i]] = i;
    list.sort(function(a, b) {
        var pa = pos[a.source.url], pb = pos[b.source.url];
        if(pa === undefined) pa = 1e9;
        if(pb === undefined) pb = 1e9;
        return pa - pb;
    });
}

// Salva l'ordine corrente dei canali visibili di un gruppo.
function saveChanOrder(ordKey, streams) {
    var urls = [];
    for(var i = 0; i < streams.length; i++)
        urls.push(streams[i].source.url);
    var m = {};
    var old = hidMap(ordStore);
    for(var x in old) m[x] = old[x];
    m[ordKey] = urls;
    ordStore.map = m;
}

/*
 *  _liveIdFromUrl — stream_id Xtream dal path /live/u/p/12345.ts
 *  (usato per entry di store legacy senza metadati).
 */
function _liveIdFromUrl(u) {
    var m = /\/live\/[^\/]+\/[^\/]+\/(\d+)\./.exec(u || '');
    return m ? parseInt(m[1], 10) : 0;
}

function _liveNameFromUrl(u) {
    try {
        var s = decodeURIComponent(u);
        var seg = s.split('/').pop() || '';
        return seg.replace(/\.\w+$/, '') || s;
    } catch(e) { return u; }
}

/*
 *  firstBrowseCat — prima categoria reale visibile (non nascosta
 *  / non bloccata): destinazione di fallback quando la vista
 *  aggregata "Tutti" e' disattivata dalle impostazioni.
 */
function firstBrowseCat(kind, cats) {

    var bm = blockedCatMap(kind, cats);
    if(cats)
        for(var i = 0; i < cats.length; i++)
            if(cats[i].id != null && !bm[String(cats[i].id)])
                return cats[i].id;
    return hasFavItems(kind) ? 'fav' : 'history';
}

/*
 *  liveStoreList — lista per le viste 'fav'/'recent' costruita
 *  dagli store, senza toccare il catalogo: le entry arricchite
 *  (toggleFav/histAdd salvano id+cat+epgid) diventano stream
 *  completi. Le entry legacy favStore[url]==1 non enumerabili
 *  non vengono migrate — nessuna scansione del catalogo.
 */
function liveStoreList(cat) {

    var list = [];

    function mk(u, meta) {
        return {
            id: (meta && meta.id != null) ? meta.id : _liveIdFromUrl(u),
            cat_id: meta ? meta.c : undefined,
            epgid: (meta && meta.e) || '',
            title: (meta && meta.t) || _liveNameFromUrl(u),
            icon: (meta && meta.i) || '',
            source: { url: u }
        };
    }

    // entrambe le sorgenti sono array enumerabili: favlist viene
    // scritto da toggleFav/migrazione, history da histAdd — i
    // kvstore non si iterano, quindi niente for..in su favStore
    var src = cat == 'fav' ? (favListStore.list || [])
                         : (histStore.list || []);
    for(var i = 0; i < src.length; i++) {
        var h = src[i];
        if(cat != 'fav' && h.k != 'live') continue;
        list.push(mk(h.u, h));
    }
    return { list: list };
}

/*
 *  killRootsIncr — distruzione incrementale di root prop: slice
 *  da 24 per tick, cede il thread ES tra una slice e l'altra
 *  cosi' il click nuovo non aspetta la distruzione della lista
 *  vecchia (prop.deleteChilds era UN blocco sincrono — con liste
 *  grandi secondi di freeze). Si usano riferimenti, non nomi:
 *  i nodi appesi dalla build nuova non sono mai toccati.
 */
function killRootsIncr(page, roots) {
    if(!roots || !roots.length) return;
    var q = roots;
    var tick = function() {
        try {
            if(prop.isZombie(page.root)) return;
            var n = 0;
            while(q.length && n++ < 24) {
                try { prop.destroy(q.shift()); } catch(e) {}
            }
            if(q.length) setTimeout(tick, 0);
        } catch(e) {}
    };
    setTimeout(tick, 0);
}

/*
 *  browseKill — variante per le pagine browse (vod/series):
 *  gli item appesi vengono tracciati in page.__browseItems e i
 *  separatori in page.__browseStrays — qui si collezionano i
 *  root e parte la distruzione incrementale.
 */
function browseKill(page) {
    var kill = [];
    var bi = page.__browseItems;
    if(bi)
        for(var i = 0; i < bi.length; i++)
            if(bi[i] && bi[i].root) kill.push(bi[i].root);
    var bs = page.__browseStrays;
    if(bs)
        for(var j = 0; j < bs.length; j++)
            if(bs[j] && bs[j].root) kill.push(bs[j].root);
    page.__browseItems = [];
    page.__browseStrays = [];
    killRootsIncr(page, kill);
}

function liveLoader(page, groups) {

    return function catLoad(cat, done) {

        // contatore di sequenza: un fetch superato dal click su un
        // altro gruppo non deve arrivare a build() — appenderebbe
        // righe fantasma a model.nodes (mai tracciate in items,
        // quindi mai distrutte) e ruberebbe page.paginator. E' la
        // causa della "lista che resta quella di prima".
        var mySeq = (catLoad.seq = (catLoad.seq || 0) + 1);
        var stale = function() { return mySeq != catLoad.seq; };

        // vista aggregata disattivata: l'ingresso senza gruppo
        // atterra sulla prima categoria reale del rail. Se il rail
        // non l'ha ancora (categorie in fetch async) si aspettano
        // via liveCats — mai il catalogo intero.
        if(cat == null && !cfg.showAll) {
            var target = null;
            for(var g0 = 0; g0 < groups.length; g0++) {
                var c0 = groups[g0].cat;
                if(c0 != null && c0 != 'fav' && c0 != 'recent') {
                    target = c0; break;
                }
            }
            if(target == null) {
                liveCats(function(cats) {
                    // un click piu' recente ha gia' preso la
                    // pagina: il fallback non deve superarlo
                    if(stale()) return;
                    var t = null;
                    if(cats)
                        for(var ci = 0; ci < cats.length; ci++)
                            if(cats[ci].id != null &&
                               !isHiddenGroup(cats[ci].id)) {
                                t = cats[ci].id; break;
                            }
                    catLoad(t || 'fav', done);
                });
                return;
            }
            cat = target;
        }

        var ordKey = (cat == null) ? '_all' : String(cat);

        // build(live): da lista canali grezza a risultato materia-
        // lizzato {streams, items, more, findUrl, hasUrl, total} —
        // identico al loader sincrono, ora invocabile sia dalla
        // cache calda sia dalla callback di una fetch async
        function build(live) {

            if(live) live = live.slice();

            // gruppo "Preferiti": filtra lo stream completo con
            // lo store (live e' gia' il catalogo intero)
            if(cat == 'fav') {
                var all = live || [];
                live = [];
                for(var i = 0; i < all.length; i++)
                    if(favStore[all[i].source.url])
                        live.push(all[i]);
            }

            // gruppo "Recenti": stream nell'ordine della
            // cronologia — mappa url->stream
            if(cat == 'recent') {
                var rall = live || [];
                live = [];
                var histl = histStore.list || [];
                var byUrl = {};
                for(var j2 = 0; j2 < rall.length; j2++)
                    byUrl[rall[j2].source.url] = rall[j2];
                for(var h2 = 0; h2 < histl.length; h2++) {
                    if(histl[h2].k != 'live') continue;
                    var rs = byUrl[histl[h2].u];
                    if(rs) live.push(rs);
                }
            }

            // viste aggregate: i canali dei gruppi nascosti o
            // bloccati dal PIN non ci devono comparire — il gate
            // sul solo rail li lascerebbe raggiungibili
            if(live && (cat == null || cat == 'fav' || cat == 'recent')) {
                var bml = blockedCatMap('live', groups);
                var lf = [];
                for(var bl = 0; bl < live.length; bl++)
                    if(!bml[String(live[bl].cat_id)]) lf.push(live[bl]);
                live = lf;
            }

            if(!live)
                return null;

            applyChanOrder(live, ordKey);
            var nums = hidMap(numStore);

        // NIENTE prop.deleteChilds qui: i root della lista vecchia
        // li distrugge il kill-loop a slice partito in load() —
        // cancellare qui di nuovo in sincrono congelerebbe il
        // thread ES per liste grandi. I separatori sono tracciati
        // in page.__strays e muoiono nella stessa passata.
        var t1 = Date.now();

        // appendItem + fillChannelEpg costano ~20 prop-op per
        // canale: con migliaia di canali e' il collo di bottiglia
        // della lista. Le righe si materializzano a blocchi via
        // paginator — la pagina apre col primo chunk, il resto
        // arriva scrollando.
        var pos = 0;
        var first = true;
        var items = [];
        var streams = [];

        var title = tr('Tutti i canali');
        for(var g = 0; g < groups.length; g++)
            if(groups[g].cat == cat)
                title = groups[g].title;

        setGuideRuler(page);

        function more() {

            var chunkItems = [];
            var chunkStreams = [];
            // primo chunk piccolo: la pagina renderizza subito,
            // i successivi sono piu' grandi e arrivano scrollando.
            // 24/80: ogni riga costa prop-op sincrone sul thread
            // ES — un primo chunk grosso ritarda il paint della
            // lista dopo il click sul gruppo
            var end = Math.min(pos + (first ? 24 : 80), live.length);
            first = false;

            // le mappe kvstore si leggono UNA volta per chunk:
            // st.map e' un getter del proxy (deserializza JSON) —
            // per-riga sarebbe un parse ad item
            var hidm = hidMap(hidChanStore);
            var renm = renameStore.map || {};

            for(; pos < end; pos++) {
                var s = live[pos];
                if(hidm[s.source.url]) continue;
                applyRename(s, renm);
                // xidx = posizione finale in streams[]: il push su
                // streams avviene dopo il ciclo, va contato anche
                // il chunk corrente altrimenti tutti gli xidx del
                // chunk coincidono e watch:N sintonizza sempre lo
                // stesso canale.
                s.xidx = streams.length + chunkStreams.length;
                s.num = nums[s.source.url] || (s.xidx + 1);
                s.fav = favStore[s.source.url] ? 1 : 0;
                s.epgurl = plugin.id + ':chanepg:' +
                    encodeURIComponent(s.title) + ':' + s.id + ':' +
                    encodeURIComponent(s.epgid || s.otitle || s.title);
                chunkItems.push(page.appendItem(plugin.id + ':playlive:' +
                    encodeURIComponent(s.title) + ':' +
                    encodeURIComponent(s.source.url), 'video', s));
                chunkStreams.push(s);
            }

            for(var k = 0; k < chunkItems.length; k++) {
                items.push(chunkItems[k]);
                streams.push(chunkStreams[k]);
            }
            // EPG differito di un tick: le righe si dipingono
            // subito al cambio gruppo, le celle della griglia
            // (~130 prop-op a canale) arrivano un frame dopo.
            // Gli zombie-check in fillPageEpg/setChannelEvents
            // scartano il riempimento se nel frattempo e' partito
            // un altro cambio gruppo.
            setTimeout(function() {
                fillPageEpg(chunkItems, chunkStreams, false);
            }, 0);
            return pos < live.length;
        }

        // primo blocco sincrono (la pagina ha subito contenuto),
        // i successivi via wantmorechilds. Il paginator va sempre
        // riassegnato: se la lista finisce subito, il primo
        // wantmorechilds ottiene haveMore(false) — un riferimento
        // stale alla categoria precedente appenderebbe righe
        // sbagliate.
        if(!live.length) {
            // gruppo vuoto (es. Preferiti senza elementi): deve
            // restare una pagina "vuota" con messaggio, non un
            // loader eterno. Il separatore va in __strays: lo
            // distrugge il kill-loop del prossimo cambio gruppo.
            (page.__strays = page.__strays || []).push(
                page.appendPassiveItem('separator', '', {
                    title: tr('Nessun elemento') }));
            page.paginator = function() { return false; };
            prop.haveMore(page.model.nodes, false);
        } else {
            more();
            if(cfg.debug)
                console.log('xctv: build cat=' + cat + ' rows=' +
                            (Date.now() - t1) + 'ms n=' + live.length);
            page.paginator = more;
            if(pos >= live.length)
                prop.haveMore(page.model.nodes, false);
        }

        return {
            streams: streams, items: items, title: title,
            total: live.length,
            more: more,
            // Zap numerico / restore ultimo canale: materializza i
            // chunk finche' l'url appare in streams[] (maxChunks
            // limita il caso di canali molto in fondo alla lista)
            findUrl: function(url, maxChunks) {
                var guard = maxChunks || 15;
                for(;;) {
                    for(var i = 0; i < streams.length; i++)
                        if(streams[i].source.url == url) return i;
                    if(pos >= live.length || guard-- <= 0 || !more())
                        return -1;
                }
            },
            // scansione a costo zero sulla lista sorgente: il
            // cambio gruppo con un canale in riproduzione chiamava
            // findUrl, che materializzava fino a 15 chunk da 160
            // item (prop-op EPG incluse) solo per scoprire che il
            // canale non c'era — il freeze percepito al click.
            hasUrl: function(url) {
                for(var i = 0; i < live.length; i++)
                    if(live[i].source.url == url) return i;
                return -1;
            }
            };
        }   // end build

        // 'recent': lista dalla cronologia arricchita — niente
        // fetch del catalogo, sempre fresca (lo store cambia ad
        // ogni zap, quindi niente cache)
        if(cat == 'recent') {
            if(done) done(build(liveStoreList(cat).list));
            return;
        }

        // 'fav': solo i preferiti dell'utente, letti da
        // favListStore — nessun fetch di rete. Una tantum, al
        // primo accesso dopo l'upgrade, gira in background una
        // scansione filtrata per recuperare i preferiti salvati
        // col vecchio formato (favStore[url]==1, non enumerabili)
        // e popolare favListStore coi metadati.
        if(cat == 'fav') {
            // solo preferiti marcati col toggle (favListStore) —
            // niente scansione del catalogo, neanche una tantum:
            // i vecchi preferiti in formato kvstore restano inerti
            var sl = liveStoreList('fav').list;
            if(done) done(build(sl));
            return;
        }

        // sorgente lista: cache calda -> riempimento sincrono;
        // altrimenti fetch async col loader visibile — niente
        // piu' _req bloccante sul click del gruppo
        var whole = (cat == null);
        var key = whole ? 'livestreams' : 'live:' + cat;
        var warm = cacheGet(key);
        if(warm) { if(done) done(build(warm)); return; }

        // loader subito: i root vecchi li distrugge il kill-loop
        // a slice partito in load() — si sovrappone alla fetch.
        page.model.loadingStatus = tr('Caricamento…');
        setLoading(page, true);

        var tReq = Date.now();
        var fin = function(list) {
            // drop del fetch superato PRIMA di build(): le righe
            // appendute da una build non piu' corrente non sono
            // tracciate e resterebbero visibili per sempre
            if(stale()) return;
            try {
                setLoading(page, false);
                if(cfg.debug)
                    console.log('xctv: fetch cat=' + cat + ' ' +
                                (Date.now() - tReq) + 'ms items=' +
                                (list ? list.length : list));
                if(prop.isZombie(page.root)) return;
                if(list) cacheSet(key, list);
                if(done) done(list ? build(list) : null);
            } catch(e) {
                try { if(done) done(null); } catch(e2) {}
            }
        };
        try {
            var a = api();
            if(whole) {
                // 'Tutti i canali' e' opt-in (cfg.showAll): fetch
                // per-categoria a memoria limitata invece del
                // catalogo intero in un colpo
                wholeByCats('live', a, null, fin);
            } else {
                if(a.getLiveStreamsByCategoryIdAsync)
                    a.getLiveStreamsByCategoryIdAsync(cat, fin);
                else fin(a.getLiveStreamsByCategoryId(cat));
            }
        } catch(e) {
            setLoading(page, false);
            if(done) done(null);
        }
    };
}


/*
 *  cycleMediaTrack — cicla la traccia attiva del player primario
 *  (audio / sottotitoli). Le tracce vivono sotto
 *  global.media.current.metadata.<kind>: selezionare un figlio
 *  (prop.select) lo attiva nel media pipe.
 */
function cycleMediaTrack(kind) {
    try {
        var list = prop.global.media.current.metadata[kind];
        var kids = [], cur = -1;
        for(var i = 0; i < 64; i++) {
            var ch = prop.getChild(list, i);
            if(!ch) break;
            kids.push(ch);
            if(prop.makeProp(ch).sel) cur = i;
        }
        if(kids.length < 2) return;
        prop.select(prop.makeProp(kids[(cur + 1) % kids.length]));
        popup.notify(String(prop.makeProp(kids[(cur + 1) % kids.length]).title), 2);
    } catch(e) {
        if(cfg.debug) console.log('xctv: cycleMediaTrack: ' + e);
    }
}

/*
 *  cycleAspect — formato video per il canale corrente: i settaggi
 *  sono per-URL nella kvstore "videoplayback" e riletti ad ogni
 *  apertura, quindi qui si scrive il profilo e si risintonizza.
 */
var ASPECT_MODES = [
    { name: tr('Auto'),        zoom: 100, hs: 0, fs: 0 },
    { name: '16:9',        zoom: 100, hs: 1, fs: 0 },
    { name: tr('Tutto schermo'), zoom: 100, hs: 0, fs: 1 },
    { name: 'Zoom 133%',   zoom: 133, hs: 0, fs: 0 },
    { name: 'Zoom 160%',   zoom: 160, hs: 0, fs: 0 }
];

function cycleAspect() {
    if(!zapPage || prop.isZombie(zapPage.root)) return;
    var m = zapPage.model;
    var cur = 0;
    try { cur = parseInt(m.aspectMode) || 0; } catch(e) {}
    cur = (cur + 1) % ASPECT_MODES.length;
    var a = ASPECT_MODES[cur];
    m.aspectMode = cur;

    try {
        var kv = require('native/kvstore');
        var url = String(m.zapcanon || '');
        if(url) {
            kv.set(url, 'videoplayback', 'vzoom', a.zoom);
            kv.set(url, 'videoplayback', 'hstretch', a.hs);
            kv.set(url, 'videoplayback', 'fstretch', a.fs);
        }
    } catch(e) {
        if(cfg.debug) console.log('xctv: aspect kvstore: ' + e);
    }

    // risintonizza per applicare il formato
    var z = '';
    try { z = String(m.zapurl); } catch(e) {}
    if(z) { m.zapurl = ''; m.zapurl = z; }
    popup.notify(tr('Formato') + ': ' + a.name, 2);
}

/*
 *  Registrazione — copia lo stream http in un file .ts dentro
 *  storage/recordings con un pump a chunk via timer (256 KB a
 *  colpo). Live: finche' non si stoppa; VOD/catch-up: fino a EOF.
 */
var rec = null;   // {pump, path}

// Pump generico stream->file: legge chunk da 256KB via timer e
// scrive su file. Ritorna {bytes, stop(), fdR, fdW}.
function pumpFile(url, path) {
    var fs = require('native/fs');
    var o = { bytes: 0, dead: false };
    o.fdR = fs.open(url, 'r');
    o.fdW = fs.open(path, 'w');
    var buf = new Uint8Array(256 * 1024);
    o.res = setInterval(function() {
        try {
            var n = fs.read(o.fdR, buf, 0, buf.length, null);
            if(!n || n <= 0) { o.stop(); return; }
            fs.write(o.fdW, buf.subarray(0, n), 0, null, null);
            o.bytes += n;
        } catch(e) { o.stop(); }
    }, 80);
    o.stop = function() {
        if(o.dead) return;
        o.dead = true;
        if(o.res) clearInterval(o.res);
        try { Core.resourceDestroy(o.fdR); } catch(e2) {}
        try { Core.resourceDestroy(o.fdW); } catch(e2) {}
    };
    return o;
}

// Cartella di destinazione delle registrazioni: cfg.recDir se
// impostata (richiede l'entitlement file-write del plugin),
// altrimenti lo storage. Ritorna null se non scrivibile.
function recDir() {
    var fs = require('native/fs');
    var dir = Core.storagePath + '/recordings';
    if(cfg.recDir) {
        dir = String(cfg.recDir).replace(/\/+$/, '');
        try { fs.mkdirs(dir, 0); return dir; } catch(e) {
            popup.notify(tr('Cartella registrazioni non scrivibile, uso quella predefinita'), 4);
            dir = Core.storagePath + '/recordings';
        }
    }
    try { fs.mkdirs(dir, 0); } catch(e) { return null; }
    return dir;
}

function recPath(name) {
    var dir = recDir();
    if(!dir) return null;
    var nm = (name || 'rec').replace(/[^\w\-]+/g, '_');
    return dir + '/' + nm + '_' +
        new Date().toISOString().replace(/[:T]/g, '-').substr(0, 19) +
        '.ts';
}

// L'elenco dei file registrati sta in recListStore (non esiste
// readdir nel modulo fs): {p: path, t: titolo, st: inizio}
function recIndexAdd(path, title) {
    var l = recListStore.list || [];
    l.push({ p: path, t: title || 'rec',
             st: Math.floor(Date.now() / 1000) });
    if(l.length > 500) l = l.slice(l.length - 500);
    recListStore.list = l;
}

function stopRecording(quiet) {
    if(!rec) return;
    rec.pump.stop();
    var mb = (rec.pump.bytes / 1048576).toFixed(1);
    if(!quiet)
        popup.notify(tr('Registrazione salvata (') + mb + ' ' + tr('MB) in') + ' ' +
                     Core.storagePath + tr('/recordings'), 5);
    rec = null;
    if(zapPage) try { zapPage.model.recording = 0; } catch(e) {}
}

function toggleRecording(s) {
    if(rec) { stopRecording(); return; }
    // una registrazione programmata e' gia' in corso: una seconda
    // connessione fallirebbe comunque (max_connections) e
    // aprirebbe due pump
    if(schedRec) {
        popup.notify(tr('Registrazione programmata in corso'), 3);
        return;
    }
    if(!s || !s.source || !s.source.url ||
       s.source.url.indexOf('http') != 0) {
        popup.notify(tr('Registrazione non disponibile su questo canale'), 3);
        return;
    }
    try {
        var path = recPath(s.title || 'canale');
        if(!path) throw tr('cartella non scrivibile');
        rec = { pump: pumpFile(s.source.url, path), path: path };
        recIndexAdd(path, s.title);
        if(zapPage) try { zapPage.model.recording = 1; } catch(e) {}
        popup.notify(tr('Registrazione avviata') + ': ' + (s.title || tr('canale')), 3);
    } catch(e) {
        popup.notify(tr('Registrazione fallita') + ': ' + e, 4);
        rec = null;
    }
}


/*
 *  Registrazioni programmate — schedStore.list =
 *  [{t: titolo programma, c: canale, u: stream url, st, sp}]
 *  schedTick (ogni 20s) avvia il pump quando entra nella finestra
 *  [st, sp) e lo ferma a sp. Una registrazione alla volta: i
 *  provider Xtream hanno di solito max_connections=1, registrare
 *  mentre si guarda un altro canale puo' fallire.
 */
var schedStore = store.create('recsched');
var schedRec = null;   // {entry, pump, path}

function schedTick() {
    var now = Math.floor(Date.now() / 1000);
    var list = schedStore.list || [];
    var changed = false;

    if(schedRec) {
        var sr = schedRec.entry;
        if(now >= sr.sp) {
            schedRec.pump.stop();
            popup.notify(tr('Registrazione completata') + ': ' + (sr.t || sr.c), 4);
            schedRec = null;
        }
        // l'entry puo' essere stata cancellata da :delrec: — lo
        // store restituisce oggetti nuovi ad ogni lettura, quindi
        // confronto su chiave (url+start) e non su riferimento
        else if(schedFind(sr.u, sr.st) < 0) {
            schedRec.pump.stop();
            schedRec = null;
        }
    }

    var out = [];
    for(var i = 0; i < list.length; i++) {
        var e = list[i];
        if(e.sp <= now) { changed = true; continue; }
        if(!e.fail && !schedRec && !rec &&
           e.st <= now && e.sp > now) {
            try {
                var p = recPath(e.t || e.c);
                if(!p) throw tr('cartella non scrivibile');
                schedRec = { entry: e, pump: pumpFile(e.u, p), path: p };
                recIndexAdd(p, e.t || e.c);
                popup.notify(tr('Registrazione programmata avviata') + ': ' + (e.t || e.c), 4);
            } catch(ex) {
                e.fail = 1;
                changed = true;
                popup.notify(tr('Registrazione programmata fallita') + ': ' + (e.t || e.c), 4);
            }
        }
        out.push(e);
    }
    if(changed) schedStore.list = out;

    // --- promemorie: notifica all'inizio del programma, niente
    // registrazione. done evita avvisi ripetuti allo stesso tick.
    var rl = remStore.list || [];
    var rchanged = false;
    for(var ri = 0; ri < rl.length; ri++) {
        var re = rl[ri];
        if(re.sp <= now) {
            rl.splice(ri, 1); ri--;
            rchanged = true;
            continue;
        }
        if(!re.done && re.st <= now) {
            popup.notify(tr('Sta iniziando') + ': ' + re.t +
                         ' — ' + re.c, 5);
            re.done = 1;
            rchanged = true;
        }
    }
    if(rchanged) remStore.list = rl;
}

setInterval(schedTick, 20000);

function remFind(st, sid) {
    var list = remStore.list || [];
    for(var i = 0; i < list.length; i++)
        if(list[i].st == st && String(list[i].sid) == String(sid))
            return i;
    return -1;
}


/*
 *  Marker "visto" + autoplay episodio successivo.
 *  L'hook 'videoscrobble' scatta a start/stop di ogni video con
 *  info = {canonical_url, title, duration, stopposition, ...}.
 *  Un episodio conta come visto se riprodotto fino in fondo o
 *  oltre il 90% (allineato alla soglia "played" di Movian):
 *  in quel caso parte il successivo (se abilitato).
 */
try {
    require('native/hook').register('videoscrobble',
        function(op, info, p, origin) {
        try {
            if(op != 'stop' || !info || !info.canonical_url) return;
            var cu = String(info.canonical_url);
            var pfx = plugin.id + ':playep:';
            if(cu.indexOf(pfx) != 0) return;

            var pos = info.stopposition != null ?
                parseFloat(info.stopposition) : -1;
            if(pos >= 0 && info.duration &&
               pos < parseFloat(info.duration) * 0.9)
                return;   // interrotto a meta': niente visto/autoplay

            watchMark(cu);
            if(!cfg.autoplayNext) return;

            var rest = cu.substring(pfx.length).split(':');
            // async: la get_series_info del successivo non blocca
            // il contesto ES (e la UI) mentre l'episodio finisce
            var a = api();
            var fin = function(eps) {
                try {
                    if(!eps || !eps.length) return;
                    for(var i = 0; i < eps.length; i++) {
                        if(String(eps[i].id) != rest[1]) continue;
                        if(i + 1 < eps.length) {
                            var nx = eps[i + 1];
                            popup.notify(tr('Prossimo episodio') + ': ' + nx.title, 3);
                            // origin = prop della pagina che ha avviato la
                            // riproduzione; come fallback il prop globale raw
                            // (prop.global e' un Proxy, backendOpen vuole
                            // l'oggetto nativo)
                            var pg = origin;
                            if(!pg) {
                                try { pg = require('native/prop').global(); }
                                catch(e2) { return; }
                            }
                            // la fetch async puo' risolversi dopo che
                            // l'utente e' uscito dal video: non
                            // risbatterlo sull'episodio successivo se
                            // la pagina origine non e' piu' corrente
                            var ou = '';
                            try { ou = String(pg.url); } catch(e3) {}
                            if(ou && currentPageUrl() != ou) return;
                            require('native/route').backendOpen(
                                pg, playepUrl(rest[0], nx.id), false);
                        }
                        return;
                    }
                } catch(e) {}
            };
            if(a.getSeriesInfoAsync)
                a.getSeriesInfoAsync(rest[0], function(eps) {
                    fin(eps ? seriesSort(eps) : eps);
                });
            else
                try { fin(seriesSort(a.getSeriesInfo(rest[0]) || [])); }
                catch(e) {}
        } catch(e) {}
    });
} catch(e) {}

function schedFind(url, st) {
    var list = schedStore.list || [];
    for(var i = 0; i < list.length; i++)
        if(list[i].u == url && list[i].st == st) return i;
    return -1;
}

/*
 *  toggleFav — aggiunge/rimuove un canale dai preferiti e
 *  aggiorna il flag metadata.fav sull'item (stella in griglia).
 */
function toggleFav(s, item) {

    var u = s.source.url;
    var on = favStore[u] ? 0 : 1;
    favStore[u] = on;
    // favlist: array enumerabile con i metadati dell'entry — la
    // vista Preferiti si ricostruisce da qui senza scaricare il
    // catalogo (i kvstore non sono iterabili via for..in)
    try {
        var fl = (favListStore.list || []).slice();
        if(on) {
            var rem = [];
            for(var fi2 = 0; fi2 < fl.length; fi2++)
                if(fl[fi2].u != u) rem.push(fl[fi2]);
            rem.push({ u: u, id: s.id, c: s.cat_id,
                       e: s.epgid || '',
                       t: s.otitle || s.title, i: s.icon || '' });
            fl = rem;
        } else {
            var keep = [];
            for(var fi3 = 0; fi3 < fl.length; fi3++)
                if(fl[fi3].u != u) keep.push(fl[fi3]);
            fl = keep;
        }
        favListStore.list = fl;
    } catch(e2) {}
    s.fav = on;
    if(item) {
        try { item.root.metadata.fav = on; } catch(e) {}
    }
    popup.notify(on ? tr('Aggiunto ai preferiti') : tr('Rimosso dai preferiti'), 2);
    return on;
}


/*
 *  hookZap — collega zapping e cambio gruppo di una pagina live.
 *  GLW consegna azioni a page.model.eventSink ("watch:N" dagli item,
 *  "group:N" dalla colonna gruppi, "Channel+"/"Channel-" dai tasti
 *  CH): qui si applica lo zap impostando model.zapurl (videoparams
 *  del widget video) e i props del banner now/next.
 *  Una sola pagina = una sola connessione stream.
 */
function hookZap(page, groups, loader, initialCat) {

    var playback = livePlaybackLifecycle(page);
    var cur = -1;
    var curUrl = null;
    var streams = [];
    var items = [];
    var curCat = null;
    var curMore = null;   // materializza un chunk extra (paginazione)
    var curFind = null;   // cerca un url materializzando chunk
    var curTotal = 0;
    var unlockedGroups = {};
    var lastZapEpg = 0;   // throttle get_short_epg su zapping rapido

    // opzioni d'aspetto/playback lette dalla view
    var m0 = page.model;
    m0.zapinfosecs = cfg.infoSecs;
    m0.shownums = cfg.showNums ? 1 : 0;
    m0.showlogos = cfg.showLogos ? 1 : 0;
    m0.palpha = (cfg.panelAlpha || 85) / 100;
    m0.accent = ({blue:'#4192ff', green:'#33cc66', orange:'#ff9933',
                  red:'#ff5544', violet:'#aa66ff'})[cfg.accent] || '#4192ff';
    m0.multiview = 0;
    m0.recording = 0;

    // zap numerico (0-9): questa pagina diventa la destinazione
    // dei tasti finche' e' la pagina corrente del navigator.
    // Il marker 'zaplive' sul root viene letto attraverso il link
    // currentpage (GetChildren segue linkedTo).
    page.root.zaplive = 1;
    zapPage = {
        root: page.root,
        model: page.model,
        url: String(page.root.url),
        numbuf: 0,
        count: function() {
            var mx = curTotal || streams.length;
            for(var mi = 0; mi < streams.length; mi++)
                if(streams[mi].num && streams[mi].num > mx)
                    mx = streams[mi].num;
            return mx;
        },
        zap: function(n) {
            // numero personalizzato prima, posizione in lista poi
            for(var zi = 0; zi < streams.length; zi++)
                if(streams[zi].num == n) { apply(zi); return; }
            // la paginazione materializza la lista a chunk: se il
            // numero va oltre quanto renderizzato, carica finche'
            // basta (o finisce la lista)
            while(curMore && streams.length <= n && curMore()) {}
            apply(n - 1);
        },
        reload: function() { load(curCat); }
    };

    function apply(idx) {

        if(!streams || !streams.length) return;

        var i = ((idx % streams.length) + streams.length) % streams.length;
        if(i == cur)
            return;
        var s = streams[i];
        cur = i;
        curUrl = s.source.url;
        // debounce: lo zapping veloce non deve scrivere due
        // file kvstore per canale
        uiSetDeb('lastChan', s.source.url);
        uiSetDeb('lastGroup', curCat);
        // cronologia "Recenti" — i canali live usano lo stesso
        // store della storia VOD con kind 'live'
        try { histAddDeb(s.title, s.icon, s.source.url, 'live',
                         { id: s.id, c: s.cat_id, e: s.epgid }); } catch(e) {}

        var canon = plugin.id + ':playlive:' + encodeURIComponent(s.title) +
                    ':' + encodeURIComponent(s.source.url);
        var m = page.model;
        m.zapidx = i;
        m.zapnum = s.num || (i + 1);
        m.zaptitle = s.title;
        m.zapicon = s.icon;
        m.zapcanon = canon;
        playback.set('videoparams:' + JSON.stringify({
            title: s.title,
            canonicalUrl: canon,
            sources: [{ url: liveTransportUrl(s.source.url) }],
            live: true,
            // senza la sonda sottotitoli lo zap e' piu' rapido —
            // come gia' fa la route :play: sugli URL /live/
            no_subtitle_scan: true
        }));

        var now = Math.floor(Date.now() / 1000);
        var evs = guideFresh() ?
            guide.eventsFor(s.epgid || s.otitle || s.title,
                            now - 3600, now + 6 * 3600) : [];

        if(!evs.length) {
            // async: lo zap non aspetta un RTT — il banner now/next
            // si aggiorna quando la risposta arriva. Throttle a
            // ~300ms: CH± veloce non deve accodare una request
            // per ogni canale attraversato (sopratutto con
            // max_connections bassi)
            var zcanon = canon;
            var zid = s.id;
            var fireEpg = function() {
            api().getShortEpgAsync(zid, 4, function(aevs) {
                try {
                    if(!aevs || !aevs.length) return;
                    if(String(m.zapcanon || '') != String(zcanon)) return;
                    var now2 = Math.floor(Date.now() / 1000);
                    var a = shiftEvs(aevs);
                    var c3 = null, n3 = null;
                    for(var q = 0; q < a.length; q++) {
                        var e3 = a[q];
                        if(e3.start <= now2 && e3.stop > now2) { c3 = e3; continue; }
                        if(e3.start > now2 && !n3) n3 = e3;
                    }
                    if(!c3 && a.length && a[0].start > now2) n3 = a[0];
                    m.zapnowtitle = c3 ? c3.title: '';
                    m.zapnowdesc = c3 ? (c3.desc || '') : '';
                    m.zapnowstart = c3 ? c3.start : 0;
                    m.zapnowstop = c3 ? c3.stop : 0;
                    m.zapnexttitle = n3 ? n3.title: '';
                    m.zapnextstart = n3 ? n3.start : 0;
                    m.zapnextstop = n3 ? n3.stop : 0;
                } catch(e) {}
            });
            };
            var dt = Date.now() - lastZapEpg;
            lastZapEpg = Date.now();
            if(dt < 300)
                setTimeout(function() {
                    if(String(m.zapcanon || '') != String(zcanon)) return;
                    try { fireEpg(); } catch(e2) {}
                }, 300);
            else {
                try { fireEpg(); } catch(e3) {}
            }
        }

        var cur2 = null, nxt = null;
        for(var k = 0; k < evs.length; k++) {
            var e = evs[k];
            if(e.start <= now && e.stop > now) { cur2 = e; continue; }
            if(e.start > now && !nxt) nxt = e;
        }
        if(!cur2 && evs.length && evs[0].start > now) nxt = evs[0];

        m.zapnowtitle = cur2 ? cur2.title: '';
        m.zapnowdesc = cur2 ? (cur2.desc || '') : '';
        m.zapnowstart = cur2 ? cur2.start : 0;
        m.zapnowstop = cur2 ? cur2.stop : 0;
        m.zapnexttitle = nxt ? nxt.title: '';
        m.zapnextstart = nxt ? nxt.start : 0;
        m.zapnextstop = nxt ? nxt.stop : 0;
    }

    // Ricarica la lista canali di un gruppo senza fermare lo
    // stream corrente; se il canale in riproduzione esiste nella
    // nuova lista riallinea `cur` così CH± riparte da lì.
    // Il loader consegna via callback (fetch async a cache
    // fredda): loadSeq scarta i load superati.
    var loadSeq = 0;
    var selIdx = -1;
    function load(cat) {

        // "Tutti i canali" disattivato dalle impostazioni: si
        // apre la prima categoria reale del rail
        if(cat == null && !cfg.showAll) {
            for(var g0 = 0; g0 < groups.length; g0++) {
                var c0 = groups[g0].cat;
                if(c0 != null && c0 != 'fav' && c0 != 'recent') {
                    cat = c0; break;
                }
            }
        }

        var mySeq = ++loadSeq;
        // drop immediato del lavoro del gruppo precedente: la coda
        // short_epg e il paginator della vecchia lista non devono
        // finire prima che parta quella nuova — era la sensazione
        // "deve ancora finire" a ogni cambio gruppo rapido
        shortQ.length = 0;
        page.paginator = function() { return false; };
        // distruzione incrementale delle righe vecchie:
        // prop.deleteChilds era UN blocco sincrono — con liste
        // grandi teneva il thread ES per secondi e il click sul
        // gruppo nuovo sembrava "aspettare". Qui i root degli
        // item (+ i separatori) si distruggono a slice da 24 per
        // tick: il loop cede il thread tra una slice e l'altra,
        // i click si intercalano, e il lavoro si sovrappone alla
        // fetch di rete. Si usano i riferimenti (non i nomi):
        // le righe appese dalla lista nuova non sono mai toccate.
        var kill = [];
        if(items)
            for(var ki = 0; ki < items.length; ki++)
                if(items[ki] && items[ki].root)
                    kill.push(items[ki].root);
        var str = page.__strays || [];
        for(var ks = 0; ks < str.length; ks++)
            if(str[ks] && str[ks].root) kill.push(str[ks].root);
        page.__strays = [];
        items = [];
        killRootsIncr(page, kill);
        // throbber subito: su click il loader deve apparire al
        // frame successivo — se la lista e' calda si spegne nello
        // stesso tick e non si vede mai
        page.model.loadingStatus = tr('Caricamento…');
        setLoading(page, true);
        try {
        loader(cat, function(r) {
            if(mySeq != loadSeq) return;
            setLoading(page, false);
            if(!r || !r.streams) {
                // fetch fallita: senza feedback il click sembrava
                // "morto" — mostra l'errore come hookBrowse
                (page.__strays = page.__strays || []).push(
                    page.appendPassiveItem('separator', '', {
                        title: tr('Caricamento fallito — riprova') }));
                page.paginator = function() { return false; };
                prop.haveMore(page.model.nodes, false);
                return;
            }
            // le richieste short_epg accodate appartenevano al
            // gruppo precedente: le righe sono zombie, i job in
            // coda farebbero solo HTTP a vuoto — si svuota (i 4
            // in volo finiscono e vengono scartati dallo
            // zombie-check)
            shortQ.length = 0;

            streams = r.streams;
            items = r.items || [];
            curCat = cat;
            curMore = r.more || null;
            curFind = r.findUrl || null;
            var curHas = r.hasUrl || null;
            curTotal = r.total || streams.length;
            setPageHeader(page, r.title + ' (' + curTotal + ')');
            // rail: aggiorna solo i due nodi che cambiano —
            // scrivere .sel su ~400 voci a ogni click era un
            // ciclo di prop-op sul thread ES. I nodi non ancora
            // creati dai chunk prendono sel da __railCat alla
            // nascita.
            page.__railCat = cat;
            if(selIdx >= 0 && selIdx < groups.length &&
               groups[selIdx].cat != cat && groups[selIdx].node) {
                try { groups[selIdx].node.sel = 0; } catch(e0) {}
            }
            selIdx = -1;
            for(var g = 0; g < groups.length; g++)
                if(groups[g].cat == cat) {
                    if(groups[g].node) groups[g].node.sel = 1;
                    selIdx = g;
                    break;
                }

            cur = -1;
            page.model.zapidx = -1;
            // riallinea `cur` al canale in riproduzione SOLO se e'
            // nel nuovo gruppo: hasUrl e' una scansione JS pura,
            // findUrl materializzerebbe chunk di prop per niente
            if(curUrl && curFind && (!curHas || curHas(curUrl) >= 0)) {
                var ri = curFind(curUrl);
                if(ri >= 0) {
                    cur = ri;
                    page.model.zapidx = ri;
                }
            }
            boot();

            // prefetch in idle delle categorie adiacenti nel rail:
            // lo zapping su/giu' tra gruppi vicini trova la lista
            // gia' in cache (come i player dedicati). In volo sono
            // deduplicate da _inflightL; stale-load scartate via
            // loadSeq.
            setTimeout(function() {
                try {
                    if(mySeq != loadSeq || prop.isZombie(page.root))
                        return;
                    var pa = api();
                    if(!pa.getLiveStreamsByCategoryIdAsync) return;
                    for(var pg = 0; pg < groups.length; pg++) {
                        if(groups[pg].cat != cat) continue;
                        for(var d = -1; d <= 1; d += 2) {
                            var nc = groups[pg + d];
                            if(!nc || nc.cat == null ||
                               nc.cat == 'fav' || nc.cat == 'recent')
                                continue;
                            var nk = 'live:' + nc.cat;
                            if(cacheGet(nk)) continue;
                            (function(c2, k2) {
                                try {
                                    pa.getLiveStreamsByCategoryIdAsync(
                                        c2, function(l) {
                                            if(l) cacheSet(k2, l);
                                        });
                                } catch(e) {}
                            })(nc.cat, nk);
                        }
                        break;
                    }
                } catch(e) {}
            }, 800);
        });
        } catch(e) {
            // l'overlay "Caricamento" copre il video: se il loader
            // esplode in modo sincrono (build/store/prop) il flag
            // resterebbe acceso e a video si vedrebbe solo il
            // quad scuro mentre l'audio continua a suonare
            setLoading(page, false);
        }
    }

    // gruppo bloccato (regex adulti o scelta utente): chiede il PIN
    // una volta per pagina, anche sul caricamento iniziale
    function gatedLoad(cat) {
        for(var g = 0; g < groups.length; g++) {
            if(groups[g].cat !== cat) continue;
            var gt = groups[g].title || '';
            if(cfg.pin && (pinLocked(gt) || isLockedCat('live:' + cat)) &&
               !unlockedGroups[cat]) {
                if(checkPin()) {
                    unlockedGroups[cat] = 1;
                    load(cat);
                }
            } else {
                load(cat);
            }
            return;
        }
        load(cat);
    }

    // Catch-up : riproduce un programma finito sul canale usando
    // l'URL timeshift — stesso player del live (zapurl), una sola
    // connessione. Con winStart/winStop riproduce quella finestra
    // (menu contestuale programma); senza, l'ultimo terminato.
    function playCatchup(s, winStart, winStop) {

        if(!s || !s.archive) return;

        var now = Math.floor(Date.now() / 1000);
        var start = winStart || 0, stop = winStop || 0;

        if(!start) {
            var evs = guideFresh() ?
                shiftEvs(guide.eventsFor(s.epgid || s.otitle || s.title,
                                         now - 24 * 3600, now)) : [];

            for(var i = 0; i < evs.length; i++) {
                var e = evs[i];
                if(e.stop <= now && e.stop > stop) {
                    start = e.start;
                    stop = e.stop;
                }
            }

            // senza EPG: ultima ora come finestra di default
            if(!start) { stop = now; start = now - 3600; }
        }

        var url = api().getCatchupUrl(s.id, start, Math.ceil((stop - start) / 60));
        if(!url) {
            popup.notify(tr('Catch-up non supportato da questa playlist'), 3);
            return;
        }

        var m = page.model;
        m.zaptitle = s.title;
        m.zapicon = s.icon;
        m.zapnowtitle = 'Rivedi: ' + s.title;
        m.zapnowdesc = '';
        m.zapnowstart = start;
        m.zapnowstop = stop;
        m.zapnexttitle = '';
        playback.set('videoparams:' + JSON.stringify({
            title: s.title,
            canonicalUrl: plugin.id + ':play:' + encodeURIComponent(s.title) +
                          ':' + encodeURIComponent(url),
            sources: [{ url: url }]
        }));
    }

    // GLW delivers to model.eventSink: "watch:N" (item activated →
    // tune + close list), "group:N" (cambio categoria) e
    // "Channel+/-" (tasti CH mentre si guarda).
    prop.subscribe(page.model.eventSink, function(type, val) {
        try {
            if(type != 'action' || prop.isZombie(page.root))
                return;
            if(val == 'Channel+') {
                apply(cur + 1);
            } else if(val == 'Channel-') {
                apply(cur - 1);
            } else if(val == 'cycleaudio') {
                cycleMediaTrack('audiostreams');
            } else if(val == 'cyclesubs') {
                cycleMediaTrack('subtitlestreams');
            } else if(val == 'aspect') {
                cycleAspect();
            } else if(val == 'record') {
                toggleRecording(streams[cur]);
            } else if(val.indexOf('catchupat:') == 0) {
                var cp = val.substr(10).split(':');
                var cai = parseInt(cp[0], 10);
                // le celle griglia sparano su ogni click: solo
                // programmi gia' conclusi aprono il catch-up
                if(streams[cai] &&
                   parseInt(cp[2], 10) <= Math.floor(Date.now() / 1000))
                    playCatchup(streams[cai],
                                parseInt(cp[1], 10), parseInt(cp[2], 10));
            } else if(val.indexOf('catchup:') == 0) {
                var ci = parseInt(val.substr(8), 10);
                if(streams[ci])
                    playCatchup(streams[ci]);
            } else if(val.indexOf('watch:') == 0) {
                apply(parseInt(val.substr(6), 10));
            } else if(val.indexOf('fav:') == 0) {
                var fi = parseInt(val.substr(4), 10);
                if(streams[fi]) {
                    toggleFav(streams[fi], items[fi]);
                    if(curCat == 'fav')
                        load('fav');
                }
            } else if(val.indexOf('moveup:') == 0 ||
                      val.indexOf('movedown:') == 0) {
                var up = val.indexOf('moveup:') == 0;
                var mi = parseInt(val.substr(up ? 7 : 9), 10);
                var mj = up ? mi - 1 : mi + 1;
                if(mi >= 0 && mj >= 0 && mi < streams.length &&
                   mj < streams.length) {
                    var tmp = streams[mi];
                    streams[mi] = streams[mj];
                    streams[mj] = tmp;
                    saveChanOrder(curCat == null ? '_all' : String(curCat),
                                  streams);
                    load(curCat);
                }
            } else if(val.indexOf('setnum:') == 0) {
                var ni = parseInt(val.substr(7), 10);
                if(streams[ni]) {
                    var rn = popup.textDialog(
                        tr('Numero canale (vuoto = automatico)') + ': ', true, true);
                    if(!rn.rejected) {
                        var nm2 = (rn.input == null) ? '' : String(rn.input);
                        var nn = parseInt(nm2, 10);
                        var m2 = {};
                        var oldn = hidMap(numStore);
                        for(var xn in oldn) m2[xn] = oldn[xn];
                        if(nn > 0) m2[streams[ni].source.url] = nn;
                        else delete m2[streams[ni].source.url];
                        numStore.map = m2;
                        popup.notify(nn > 0 ? tr('Numero assegnato') + ': ' + nn :
                                     tr('Numerazione automatica'), 2);
                        load(curCat);
                    }
                }
            } else if(val.indexOf('rename:') == 0) {
                var ri = parseInt(val.substr(7), 10);
                if(streams[ri]) {
                    var rs = streams[ri];
                    var rr = popup.textDialog(
                        tr('Nuovo nome canale (vuoto = originale)') + ': ', true, true);
                    if(!rr.rejected) {
                        var nm = (rr.input == null) ? '' : String(rr.input);
                        setChanName(rs, nm);
                        popup.notify(nm ? tr('Canale rinominato in "') + nm + '"' :
                                     tr('Nome originale ripristinato'), 2);
                        load(curCat);
                        if(cur >= 0)
                            page.model.zaptitle = streams[cur].title;
                    }
                }
            } else if(val.indexOf('hide:') == 0) {
                var hi = parseInt(val.substr(5), 10);
                if(streams[hi]) {
                    hidSet(hidChanStore, streams[hi].source.url, 1);
                    popup.notify(tr('Canale nascosto (ripristina dalle Impostazioni)'), 3);
                    var keepUrl = curUrl;
                    load(curCat);
                    curUrl = keepUrl;
                    if(curUrl)
                        for(var ri = 0; ri < streams.length; ri++)
                            if(streams[ri].source.url == curUrl) { cur = ri; break; }
                }
            } else if(val.indexOf('hidegroup:') == 0) {
                var hg = parseInt(val.substr(10), 10);
                if(hg >= 0 && hg < groups.length &&
                   groups[hg].cat != 'fav' && groups[hg].cat != 'recent' &&
                   groups[hg].cat !== null) {
                    var hideCat = groups[hg].cat;
                    hidSet(hidGroupStore, hideCat, 1);
                    popup.notify(tr('Gruppo nascosto (ripristina dalle Impostazioni)'), 3);
                    groups = fillLiveGroups(page, groups, curCat, cacheGet('livecats'));
                    load(curCat === hideCat ? null : curCat);
                }
            } else if(val.indexOf('gmoveup:') == 0) {
                var gu = parseInt(val.substr(8), 10);
                if(gu > 0 && gu < groups.length) {
                    var gt1 = groups[gu - 1];
                    groups[gu - 1] = groups[gu];
                    groups[gu] = gt1;
                    saveGroupOrder(groups);
                    groups = fillLiveGroups(page, groups, groups[gu - 1].cat, cacheGet('livecats'));
                }
            } else if(val.indexOf('gmovedown:') == 0) {
                var gd = parseInt(val.substr(10), 10);
                if(gd >= 0 && gd < groups.length - 1) {
                    var gt2 = groups[gd + 1];
                    groups[gd + 1] = groups[gd];
                    groups[gd] = gt2;
                    saveGroupOrder(groups);
                    groups = fillLiveGroups(page, groups, groups[gd + 1].cat, cacheGet('livecats'));
                }
            } else if(val.indexOf('unhide:') == 0) {
                var nh = Object.keys(hidMap(hidChanStore)).length +
                         Object.keys(hidMap(hidGroupStore)).length;
                hidChanStore.map = {};
                hidGroupStore.map = {};
                popup.notify(nh ? tr('Ripristinati') + ' ' + nh + ' ' + tr('elementi') :
                             tr('Nulla da ripristinare'), 3);
                groups = fillLiveGroups(page, groups, curCat, cacheGet('livecats'));
                load(curCat);
            } else if(val.indexOf('group:') == 0) {
                var gi = parseInt(val.substr(6), 10);
                if(gi >= 0 && gi < groups.length)
                    gatedLoad(groups[gi].cat);
            }
        } catch(e) {}
    }, {
        autoDestroy: true,
    });

    // EPG lazy sul focus (come fanno TiviMate/OTT Player: il
    // palinsesto si carica solo per le righe che si guardano).
    // Senza guida bulk, selectOnFocus spedisce selectchild al
    // parent: qui si accoda get_short_epg per il canale sotto il
    // cursore + 2 di lookahead, deduplicato da shortReq. Con la
    // guida XMLTV caricata le righe sono gia' coperte in memoria.
    prop.subscribe(page.model.nodes, function(type, child) {
        try {
            if(type != 'selectchild' || prop.isZombie(page.root))
                return;
            if(guideFresh()) return;
            var x = parseInt(prop.makeProp(child).metadata.xidx, 10);
            if(isNaN(x) || x < 0) return;
            for(var k = x; k <= x + 2 && k < streams.length; k++)
                if(items[k])
                    shortEpgQueue(items[k], streams[k], false);
        } catch(e) {}
    }, {
        autoDestroy: true,
    });

    // Start playing the first channel immediately,
    // the list overlay is drawn over it. Con "ultimo canale"
    // attivo si riparte dal gruppo/canale dell'ultima sessione.
    // Con cache fredda il loader risponde in callback: l'avvio
    // e' differito al primo load che porta streams non vuoti.
    var booted = false;
    var bootRetried = false;
    function boot() {
        if(booted) return;
        var startIdx = -1;
        if(cfg.lastChan && uiStore.lastChan && curFind)
            // materializza i chunk fino al canale (capped dentro
            // findUrl)
            startIdx = curFind(uiStore.lastChan);
        // il gruppo di restore non ha prodotto canali -> default.
        // Solo se si era davvero tentato il restore lastChan:
        // un gruppo vuoto (Preferiti/Recenti senza elementi, o
        // una categoria vuota) deve restare vuoto, non rimbalzare
        // altrove in loop col loader che continua a girare.
        if(!streams.length && curCat !== initialCat && !bootRetried &&
           cfg.lastChan && uiStore.lastChan) {
            bootRetried = true;
            gatedLoad(initialCat);
            return;
        }
        if(!streams.length) return;   // load fallito/vuoto: ritenta
        booted = true;
        apply(startIdx >= 0 ? startIdx : 0);
    }

    var startCat = initialCat;
    if(cfg.lastChan && uiStore.lastChan &&
       uiStore.lastGroup !== undefined && uiStore.lastGroup !== null &&
       uiStore.lastGroup !== initialCat)
        startCat = uiStore.lastGroup;
    gatedLoad(startCat);
    boot();   // cache calda: streams gia' presenti, avvio subito

    // Quando un'altra pagina copre questa (es. Impostazioni o la
    // home) il widget video resta vivo e continuerebbe a suonare
    // sotto: livePlaybackLifecycle azzera model.zapurl appena
    // il navigatore seleziona un'altra pagina, senza polling.
    // Al ritorno si ripristina lo stream; alla distruzione
    // della pagina vengono rimosse le sottoscrizioni.
    // Su Android si usa lo stop ordinario del player, senza
    // anticipare il rilascio di MediaCodec o della Surface.
    // I caricamenti asincroni passano da playback.set: se la
    // pagina non e' corrente, l'URL viene conservato senza play.
    // La navigazione nei gruppi non seleziona un'altra pagina
    // e quindi non interrompe il canale in riproduzione.

    return {
        // refill del rail quando le categorie arrivano in async:
        // stesso array condiviso con liveLoader — il cambio
        // gruppo successivo vede gia' le nuove voci
        refill: function(cats) {
            if(prop.isZombie(page.root)) return;
            groups = fillLiveGroups(page, groups, curCat, cats);
        }
    };
}


/*
 *  fillRail — rail categorie delle sezioni Film/Serie (stesso
 *  layout dei gruppi live): "Tutti" + categorie in
 *  page.model.groups.
 */
function fillRail(page, cats, activeCat, kind) {

    var groups = [];
    // pseudo-categoria "Continua a guardare": solo se la
    // cronologia contiene elementi di questo tipo
    var hist = histStore.list || [];
    var hasHist = false;
    for(var hi = 0; hi < hist.length; hi++)
        if(hist[hi].k == kind) { hasHist = true; break; }
    if(hasHist)
        groups.push({ cat: 'history', title: tr('Continua a guardare') });

    // pseudo-categoria "Preferiti": solo se ci sono elementi
    // marcati di questo tipo
    if(hasFavItems(kind))
        groups.push({ cat: 'fav', title: tr('Preferiti') });

    // "Tutti" materializza il catalogo intero: opt-in via
    // Impostazioni (rischio OOM su liste grandi). Per kind 'eps'
    // il gruppo resta sempre (sono gli episodi di UNA serie,
    // decine di item al massimo)
    if(cfg.showAll || kind == 'eps')
        groups.push({ cat: 'all', title: tr('Tutti') });
    if(cats)
        for(var i = 0; i < cats.length; i++) {
            if(isHiddenBrowseGroup(kind, cats[i].id)) continue;
            groups.push({ cat: cats[i].id, title: cats[i].title });
        }

    // ordine manuale salvato (browseOrdStore[kind] = chiavi)
    var gkeys = browseOrdStore[kind];
    if(gkeys && gkeys.length) {
        var rank = {};
        for(var ri = 0; ri < gkeys.length; ri++) rank[gkeys[ri]] = ri;
        var dec = [];
        for(var di = 0; di < groups.length; di++)
            dec.push({ g: groups[di], i: di });
        dec.sort(function(a, b) {
            var ra = rank[grpKey(a.g.cat)];
            var rb = rank[grpKey(b.g.cat)];
            if(ra === undefined) ra = 9999;
            if(rb === undefined) rb = 9999;
            return ra != rb ? ra - rb : a.i - b.i;
        });
        var sorted = [];
        for(var si = 0; si < dec.length; si++) sorted.push(dec[si].g);
        groups = sorted;
    }

    // rail a chunk come fillLiveGroups: centinaia di categorie
    // non bloccano piu' il primo paint della pagina. Teardown
    // incrementale dei nodi vecchi via __railNodes (riferimenti).
    var gen = (page.__railGen = (page.__railGen || 0) + 1);
    killRootsIncr(page, page.__railNodes);
    page.__railNodes = [];
    page.__railCat = activeCat;
    var mkNode = function(i) {
        var n = prop.createRoot();
        n.metadata.title = groups[i].title;
        // gli pseudo-gruppi (Continua/Tutti) non si nascondono
        n.metadata.canhide = (groups[i].cat != 'history' &&
                              groups[i].cat != 'fav' &&
                              groups[i].cat != 'all') ? 1 : 0;
        n.xidx = i;
        n.sel = (groups[i].cat == page.__railCat) ? 1 : 0;
        groups[i].node = n;
        page.__railNodes.push(n);
        prop.setParent(n, page.model.groups);
    };
    var RAIL_INIT = 48;
    var ni = 0;
    var ne = Math.min(RAIL_INIT, groups.length);
    for(; ni < ne; ni++) mkNode(ni);
    if(ni < groups.length) {
        var railFill = function() {
            if(page.__railGen != gen || prop.isZombie(page.root))
                return;
            var e2 = Math.min(ni + 64, groups.length);
            for(; ni < e2; ni++) mkNode(ni);
            if(ni < groups.length)
                setTimeout(railFill, 0);
        };
        setTimeout(railFill, 0);
    }
    return groups;
}


/*
 *  browseLoader — ripopola page.model.nodes con i titoli della
 *  categoria selezionata (vod o serie). kind = 'vod'|'series'.
 */
function browseLoader(page, kind, cats) {

    // catLoader.keys: chiavi vodkey degli elementi nell'ordine
    // mostrato — serve al menu contestuale per gli swap su/giu'
    // catLoader.seq: generation counter — due click rapidi su
    // categorie diverse lasciano in volo due fetch: solo la piu'
    // recente puo' riempire la pagina (altrimenti si vedono gli
    // item del gruppo sbagliato col rail selezionato su un altro)
    var isSeries = (kind == 'series');

    return function catLoader(cat, done) {

        var mySeq = (catLoader.seq = (catLoader.seq || 0) + 1);

        // done(err, count): err='fail' se la fetch non riesce.
        // Cache calda -> riempimento sincrono; altrimenti fetch
        // async e la pagina mostra "Caricamento" finche' i dati
        // non arrivano.

        // vista aggregata "Tutti" disattivata (cfg.showAll off):
        // l'ingresso senza categoria atterra sulla prima
        // categoria reale visibile, mai sul catalogo intero
        if(cat == 'all' && !cfg.showAll) {
            var bm0 = blockedCatMap(kind, cats);
            var next = null;
            if(cats)
                for(var c0 = 0; c0 < cats.length; c0++)
                    if(cats[c0].id != null && !bm0[String(cats[c0].id)]) {
                        next = cats[c0].id; break;
                    }
            if(next != null) cat = next;
            else if(hasFavItems(kind)) cat = 'fav';
            else cat = 'history';
        }

        if(cat == 'history') {
            // "Continua a guardare": items dalla cronologia con
            // url diretto di riproduzione
            var hist = histStore.list || [];
            browseKill(page);
            var n = 0;
            for(var i = 0; i < hist.length; i++) {
                if(hist[i].k != kind) continue;
                page.__browseItems.push(
                    page.appendItem(plugin.id + ':play:' +
                        encodeURIComponent(hist[i].t) + ':' +
                        encodeURIComponent(hist[i].u), 'video',
                        { title: hist[i].t, icon: hist[i].i,
                          source: { url: hist[i].u } }));
                n++;
            }
            done(null, n);
            return;
        }

        // 'fav': solo gli elementi marcati dall'utente, letti da
        // favItemStore (entry arricchite con titolo/icona/url al
        // toggle) — niente fetch del catalogo, nessuno scan per
        // recuperare le entry legacy (valore 1 senza metadati:
        // vengono ignorate, il ri-toggle le risalva complete)
        if(cat == 'fav') {
            var pfx = kind + ':';
            var fm0 = hidMap(favItemStore);
            var favs = [];
            for(var k in fm0) {
                if(!fm0[k] || k.indexOf(pfx) != 0) continue;
                var fv = fm0[k], fid = k.substr(pfx.length);
                if(fv && typeof fv == 'object' && fv.u)
                    favs.push({ id: fid, cat_id: fv.c,
                                title: fv.t || ('ID ' + fid),
                                icon: fv.i || '',
                                source: { url: fv.u } });
            }
            done(null, fill(favs));
            return;
        }

        // 'all' riusa la chiave condivisa col searcher
        var key = cat == 'all' ? (isSeries ? 'series' : 'vodstreams')
                               : (isSeries ? 'series:' : 'vod:') + cat;

        function fill(list) {

            // 'fav': solo gli elementi marcati preferiti
            if(cat == 'fav') {
                var favm0 = hidMap(favItemStore);
                var favs = [];
                for(var fi = 0; fi < list.length; fi++)
                    if(favm0[kind + ':' + list[fi].id])
                        favs.push(list[fi]);
                list = favs;
            }

            // i contenuti dei gruppi nascosti o bloccati dal PIN
            // restano esclusi dalle viste aggregate — il gate sul
            // solo rail li lascerebbe raggiungibili senza PIN
            if(cat == 'all' || cat == 'fav') {
                var bm = blockedCatMap(kind, cats);
                var hasBm = false;
                for(var bk in bm) { hasBm = true; break; }
                if(hasBm) {
                    var bf = [];
                    for(var bi = 0; bi < list.length; bi++)
                        if(!bm[String(list[bi].cat_id)])
                            bf.push(list[bi]);
                    list = bf;
                }
            }

            // ordinamento catalogo (la cache va copiata, non mutata)
            if(cfg.sortMode != 'default') {
                list = list.slice();
                if(cfg.sortMode == 'name')
                    list.sort(function(a, b) {
                        return a.title.toLowerCase() < b.title.toLowerCase() ? -1 :
                               (a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0);
                    });
                else if(cfg.sortMode == 'added')
                    list.sort(function(a, b) { return (b.added || 0) - (a.added || 0); });
                else if(cfg.sortMode == 'rating')
                    list.sort(function(a, b) {
                        return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
                    });
            }

            // teardown incrementale come il live: i poster vecchi
            // muoiono a slice in background, il fill non aspetta
            browseKill(page);

            // gli elementi nascosti singolarmente non si
            // materializzano (il catalogo in cache resta integro)
            var hidim = hidMap(hidItemStore);
            var disp = [];
            for(var di = 0; di < list.length; di++)
                if(!hidim[kind + ':' + list[di].id])
                    disp.push(list[di]);
            list = disp;

            // ordine manuale salvato (riordino da menu contestuale)
            if(canOrderItems(kind, cat))
                list = applyItemOrder(list, kind + ':' + cat, kind);

            var total = list.length;
            if(!total) {
                page.__browseStrays.push(
                    page.appendPassiveItem('separator', '', {
                        title: tr('Nessun elemento') }));
                page.paginator = function() { return false; };
                prop.haveMore(page.model.nodes, false);
                return 0;
            }

            // paginazione come liveLoader: decine di migliaia di
            // poster non si appendono in un colpo — primo chunk
            // piccolo, il resto via paginator scrollando
            var pos = 0, first = true;
            function more() {
                var end = Math.min(pos + (first ? 60 : 240), total);
                first = false;
                // mappe kvstore lette una volta per chunk, non per
                // riga: st.map e' un getter del proxy
                var namesm = hidMap(nameItemStore);
                var favm = hidMap(favItemStore);
                var bitems = page.__browseItems;
                for(; pos < end; pos++) {
                    var it = list[pos];
                    var u = isSeries ?
                        plugin.id + ':seriesinfo:' + encodeURIComponent(it.title) + ':' + it.id :
                        plugin.id + ':vodinfo:' + encodeURIComponent(it.title) + ':' + it.id;
                    // playurl: riproduzione diretta dal menu
                    // contestuale (solo VOD — le serie aprono la
                    // pagina episodi); vodkey: nascondi elemento
                    it.vodkey = kind + ':' + it.id;
                    // rinomina elemento: otitle conserva l'originale
                    // (usato anche per l'URL di playurl)
                    if(it.otitle === undefined) it.otitle = it.title;
                    it.title = namesm[it.vodkey] || it.otitle;
                    it.playurl = (!isSeries && it.source && it.source.url) ?
                        plugin.id + ':play:' + encodeURIComponent(it.otitle) + ':' +
                        encodeURIComponent(it.source.url) : '';
                    it.fav = favm[it.vodkey] ? 1 : 0;
                    bitems.push(page.appendItem(u, 'directory', it));
                }
                return pos < total;
            }
            // chiavi nell'ordine mostrato — il menu contestuale le
            // usa per gli swap Sposta su/giu'; itemByKey serve al
            // toggle preferiti per salvare la categoria dell'item
            // (cosi' la vista Preferiti fetcha solo quelle)
            var dkeys = [];
            var byKey = {};
            for(var dk = 0; dk < list.length; dk++) {
                dkeys.push(kind + ':' + list[dk].id);
                byKey[dkeys[dk]] = list[dk];
            }
            catLoader.keys = dkeys;
            catLoader.itemByKey = byKey;

            more();
            page.paginator = more;
            if(pos >= total)
                prop.haveMore(page.model.nodes, false);
            return total;
        }

        var hit = cacheGet(key);
        if(hit) { done(null, fill(hit)); return; }

        // loader standard di Movian (throbber + status) finche'
        // la fetch async non completa — il teardown dei poster
        // vecchi gira a slice in background, non blocca
        page.model.loadingStatus = tr('Caricamento…');
        setLoading(page, true);
        browseKill(page);

        var fin = function(list) {
            // risposta tardiva di un load superato: scarta tutto,
            // la pagina la riempie il load corrente
            if(mySeq != catLoader.seq) return;
            try {
                setLoading(page, false);
                if(cfg.debug)
                    console.log('xctv: browse ' + kind + ' cat=' + cat +
                                ' -> ' + (list ? list.length : list));
                if(prop.isZombie(page.root)) return;
                if(list) cacheSet(key, list);
                done(list ? null : 'fail', list ? fill(list) : -1);
            } catch(e) {
                console.log('xctv: browse fin: ' + e);
                try { done('fail', -1); } catch(e2) {}
            }
        };
        try {
            // fallback sync per le lib senza varianti Async
            // (m3u/stalker lavorano su liste locali, non servono)
            var a = api();
            if(cat == 'all')
                wholeStreams(kind, fin);
            else if(isSeries) {
                if(a.getSeriesByCategoryIdAsync) a.getSeriesByCategoryIdAsync(cat, fin);
                else fin(a.getSeriesByCategoryId(cat));
            } else {
                if(a.getVodStreamsByCategoryIdAsync) a.getVodStreamsByCategoryIdAsync(cat, fin);
                else fin(a.getVodStreamsByCategoryId(cat));
            }
        } catch(e) {
            setLoading(page, false);
            done('fail', -1);
        }
    };
}


/*
 *  hookBrowse — cambio categoria in-place per le pagine
 *  Film/Serie (eventSink "group:N"), senza stream attivo.
 *  Gestisce anche il menu contestuale gruppo: gmoveup:/gmovedown:
 *  (ordine manuale), hidegroup:/unhide: (nascosti) e hideitem:
 *  (singolo elemento dal menu del poster).
 */
function hookBrowse(page, groups, loader, initialCat, keepTitle, kind, cats) {

    var kindPref = (kind == 'series') ? 'series:' :
                   (kind == 'eps') ? 'eps:' : 'vod:';
    var curCat = initialCat;
    var loadSeq = 0;
    var selIdx = -1;

    function load(cat) {

        // "Tutti" disattivato dalle impostazioni: si apre la
        // prima categoria reale del rail (kind 'eps' = stagioni
        // di una serie, 'all' li' resta sempre lecito)
        if(cat == 'all' && !cfg.showAll && kind != 'eps')
            cat = firstBrowseCat(kind, cats);

        curCat = cat;
        var myLoad = ++loadSeq;
        // la view mostra "Sposta su/giu'" solo su categorie
        // riordinabili (fuori da history/all, sort di default)
        try {
            page.model.canitemorder = canOrderItems(kind, cat) ? 1 : 0;
        } catch(e) {}
        // sel subito: feedback istantaneo al click sul rail, i
        // contenuti arrivano dalla callback del loader. Solo i
        // due nodi che cambiano: scrivere .sel su tutte le voci
        // era ~400 prop-op a click; i nodi tardivi dei chunk
        // prendono sel da __railCat alla nascita
        page.__railCat = cat;
        if(selIdx >= 0 && selIdx < groups.length &&
           groups[selIdx].cat != cat && groups[selIdx].node) {
            try { groups[selIdx].node.sel = 0; } catch(e0) {}
        }
        selIdx = -1;
        for(var g = 0; g < groups.length; g++)
            if(groups[g].cat == cat) {
                if(groups[g].node) groups[g].node.sel = 1;
                selIdx = g;
                break;
            }

        loader(cat, function(err, count) {
            // load superato nel frattempo: il nuovo load governa
            // loader/titolo/nodi
            if(myLoad != loadSeq) return;
            try {
                // il loader e' attivo solo durante fetch async: qui
                // si spegne per entrambi i path (cache hit e rete)
                setLoading(page, false);
                if(prop.isZombie(page.root)) return;
                if(err) {
                    browseKill(page);
                    page.__browseStrays.push(
                        page.appendPassiveItem('separator', '', {
                            title: tr('Caricamento fallito — riprova') }));
                    setPageHeader(page, tr('Errore'));
                    // niente paginator stale: scrollando, la vecchia
                    // closure more() appenderebbe item della lista
                    // precedente sotto l'errore
                    page.paginator = function() { return false; };
                    prop.haveMore(page.model.nodes, false);
                    return;
                }
                var title = '';
                for(var g = 0; g < groups.length; g++)
                    if(groups[g].cat == cat) title = groups[g].title;
                if(!keepTitle)
                    setPageHeader(page, title + ' (' + count + ')');
            } catch(e) {}
        });
    }

    var unlockedGroups = {};

    function gatedLoad(cat) {
        for(var g = 0; g < groups.length; g++) {
            if(groups[g].cat !== cat) continue;
            var gt = groups[g].title || '';
            if(cfg.pin && (pinLocked(gt) || isLockedCat(kindPref + cat)) &&
               !unlockedGroups[cat]) {
                if(checkPin()) {
                    unlockedGroups[cat] = 1;
                    load(cat);
                }
            } else {
                load(cat);
            }
            return;
        }
        load(cat);
    }

    prop.subscribe(page.model.eventSink, function(type, val) {
        try {
            if(type != 'action' || prop.isZombie(page.root))
                return;
            if(val.indexOf('group:') == 0) {
                var gi = parseInt(val.substr(6), 10);
                if(gi >= 0 && gi < groups.length)
                    gatedLoad(groups[gi].cat);
            } else if(val.indexOf('gmoveup:') == 0) {
                var gu = parseInt(val.substr(8), 10);
                if(gu > 0 && gu < groups.length) {
                    var gt1 = groups[gu - 1];
                    groups[gu - 1] = groups[gu];
                    groups[gu] = gt1;
                    saveBrowseOrder(kind, groups);
                    groups = fillRail(page, cats, groups[gu - 1].cat, kind);
                }
            } else if(val.indexOf('gmovedown:') == 0) {
                var gd = parseInt(val.substr(10), 10);
                if(gd >= 0 && gd < groups.length - 1) {
                    var gt2 = groups[gd + 1];
                    groups[gd + 1] = groups[gd];
                    groups[gd] = gt2;
                    saveBrowseOrder(kind, groups);
                    groups = fillRail(page, cats, groups[gd + 1].cat, kind);
                }
            } else if(val.indexOf('hidegroup:') == 0) {
                var hg = parseInt(val.substr(10), 10);
                if(hg >= 0 && hg < groups.length &&
                   groups[hg].cat != 'all' && groups[hg].cat != 'fav' &&
                   groups[hg].cat != 'history') {
                    var hideCat = groups[hg].cat;
                    hidSet(hidBrowseGrpStore, kindPref + hideCat, 1);
                    popup.notify(tr('Gruppo nascosto (ripristina dalle Impostazioni)'), 3);
                    var defCat = cfg.showAll ? 'all' : firstBrowseCat(kind, cats);
                    groups = fillRail(page, cats, defCat, kind);
                    load(curCat === hideCat ? defCat : curCat);
                }
            } else if(val.indexOf('favitem:') == 0) {
                var fkey = val.substr(8);
                if(fkey) {
                    var fm = hidMap(favItemStore);
                    var on = fm[fkey] ? 0 : 1;
                    // entry arricchita coi metadati dell'item
                    // (categoria + titolo/icona/url): la vista
                    // Preferiti si costruisce dallo store senza
                    // fetch di rete
                    var fm2 = {};
                    for(var fk in fm) fm2[fk] = fm[fk];
                    var fit = (loader.itemByKey || {})[fkey];
                    fm2[fkey] = on ? {
                        c: fit ? fit.cat_id : null,
                        t: fit ? (fit.otitle || fit.title) : null,
                        i: fit ? (fit.icon || '') : '',
                        u: fit && fit.source ? fit.source.url : ''
                    } : 0;
                    favItemStore.map = fm2;
                    // la cache della vista preferiti e' obsoleta
                    delete cache[kind == 'series' ? 'seriesfav' : 'vodfav'];
                    popup.notify(on ? tr('Aggiunto ai preferiti') :
                                 tr('Rimosso dai preferiti'), 2);
                    // la voce di rail compare/sparisce col refill;
                    // il contenuto si ricarica solo dentro 'fav'
                    var stayCat = curCat;
                    if(curCat === 'fav' && !on && !hasFavItems(kind))
                        stayCat = cfg.showAll ? 'all' : firstBrowseCat(kind, cats);
                    groups = fillRail(page, cats, stayCat, kind);
                    if(curCat === 'fav') load(stayCat);
                }
            } else if(val.indexOf('hideitem:') == 0) {
                var ikey = val.substr(9);
                // ikey = 'vod:id' / 'series:id' gia' con prefisso
                if(ikey) {
                    hidSet(hidItemStore, ikey, 1);
                    popup.notify(tr('Elemento nascosto (ripristina dalle Impostazioni)'), 3);
                    load(curCat);
                }
            } else if(val.indexOf('imoveup:') == 0 ||
                      val.indexOf('imovedown:') == 0) {
                // riordino manuale: swap con l'elemento adiacente
                // nell'ordine mostrato (catLoader.keys), persistito
                // in itemOrdStore come nel chanorder live
                var iup = val.indexOf('imoveup:') == 0;
                var ikey = val.substr(iup ? 8 : 10);
                var ks = loader.keys || [];
                var ii = -1;
                for(var ki = 0; ki < ks.length; ki++)
                    if(ks[ki] == ikey) { ii = ki; break; }
                var jj = iup ? ii - 1 : ii + 1;
                if(ii >= 0 && jj >= 0 && jj < ks.length) {
                    var tmpk = ks[ii]; ks[ii] = ks[jj]; ks[jj] = tmpk;
                    itemOrdStore[kind + ':' + curCat] = ks;
                    load(curCat);
                }
            } else if(val.indexOf('renameitem:') == 0) {
                var rkey = val.substr(11);
                var rr = popup.textDialog(
                    tr('Nuovo nome (vuoto = originale)') + ': ', true, true);
                if(!rr.rejected) {
                    var nm = (rr.input == null) ? '' : String(rr.input);
                    var nm2 = {};
                    var onm = hidMap(nameItemStore);
                    for(var xn2 in onm) nm2[xn2] = onm[xn2];
                    if(nm) nm2[rkey] = nm; else delete nm2[rkey];
                    nameItemStore.map = nm2;
                    popup.notify(nm ? tr('Elemento rinominato') :
                                 tr('Nome originale ripristinato'), 2);
                    load(curCat);
                }
            } else if(val.indexOf('unhide:') == 0) {
                var nh = Object.keys(hidMap(hidBrowseGrpStore)).length +
                         Object.keys(hidMap(hidItemStore)).length;
                hidBrowseGrpStore.map = {};
                hidItemStore.map = {};
                popup.notify(nh ? tr('Ripristinati') + ' ' + nh + ' ' + tr('elementi') :
                             tr('Nulla da ripristinare'), 3);
                groups = fillRail(page, cats, curCat, kind);
                load(curCat);
            }
        } catch(e) {
            console.log('xctv: browse event: ' + e);
        }
    }, {
        autoDestroy: true,
    });

    gatedLoad(initialCat);
}


/*
 *  openBrowse — pagina Film / Serie TV :
 *  rail categorie a sinistra + griglia poster a destra.
 */
function openBrowse(page, kind, cat, defTitle) {

    setPageHeader(page, defTitle);
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/browse.view";
    setLoading(page, true);
    page.model.loadingStatus = tr('Caricamento…');

    var start = function(cats) {
        try {
            if(prop.isZombie(page.root)) return;
            cats = cats || [];
            var groups = fillRail(page, cats, cat, kind);
            fillAppMenu(page, kind);
            // il setLoading(true) iniziale si spegne nella done()
            // di hookBrowse: qui si spegnerebbe dopo il SET del
            // fetch async
            hookBrowse(page, groups, browseLoader(page, kind, cats),
                       cat, false, kind, cats);
        } catch(e) {
            setLoading(page, false);
        }
    };

    // categorie in async: la pagina mostra il loader finche' non
    // arrivano (anche il rail era un _req bloccante all'apertura)
    var key = kind == 'series' ? 'seriescats' : 'vodcats';
    var warm = cacheGet(key);
    if(warm) { start(warm); return; }

    var a = api();
    var fin = function(cats) {
        try {
            if(cats) cacheSet(key, cats);
            start(cats);
        } catch(e) {
            try { setLoading(page, false); } catch(e2) {}
        }
    };
    try {
        if(kind == 'series') {
            if(a.getSeriesCategoriesAsync) a.getSeriesCategoriesAsync(fin);
            else fin(a.getSeriesCategories());
        } else {
            if(a.getVodCategoriesAsync) a.getVodCategoriesAsync(fin);
            else fin(a.getVodCategories());
        }
    } catch(e) { fin(null); }
}


new page.Route(plugin.id + ":vodbrowse:(.*):(.*)", function(page, title, cat) {
    openBrowse(page, 'vod', cat, decodeURIComponent(title));
});

new page.Route(plugin.id + ":vodbrowse:(.*)", function(page, title) {
    openBrowse(page, 'vod', 'all', decodeURIComponent(title));
});

new page.Route(plugin.id + ":seriesbrowse:(.*):(.*)", function(page, title, cat) {
    openBrowse(page, 'series', cat, decodeURIComponent(title));
});

new page.Route(plugin.id + ":seriesbrowse:(.*)", function(page, title) {
    openBrowse(page, 'series', 'all', decodeURIComponent(title));
});


/*
 *  Cerca — pagina con campo di testo che naviga a search:query
 *  (la ricerca globale include XCtv via page.Searcher).
 */
new page.Route(plugin.id + ":searchui:(.*)", function(page) {

    setPageHeader(page, tr('Cerca'));
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/searchui.view";
    setLoading(page, false);
});


/*
 *  Impostazioni — pagina in-app  con rail sezioni
 *  (Playlist / EPG / Riproduzione / Aspetto / Genitori / Info).
 */
new page.Route(plugin.id + ":settings", function(page) {

    setPageHeader(page, tr('Impostazioni'));
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/settingsui.view";
    setLoading(page, true);

    var secs = [
        { id: 'playlist',   title: tr('Playlist') },
        { id: 'epg',        title: tr('EPG') },
        { id: 'playback',   title: tr('Riproduzione') },
        { id: 'appearance', title: tr('Aspetto') },
        { id: 'parental',   title: tr('Controllo genitori') },
        { id: 'sistema',    title: tr('Sistema') },
        { id: 'info',       title: tr('Informazioni') }
    ];

    hookSettingsPage(page, secs, 0);
    fillAppMenu(page, 'settings');
    setLoading(page, false);
});


/*
 *  Aggiungi playlist — form Xtream Codes 
 *  (campi editabili via dialog + pulsante Connetti).
 */
function addPlaylistPage(page, idxStr) {

    var editIdx = null;
    if(idxStr != null && idxStr !== '') {
        var ei = parseInt(idxStr, 10);
        var pl0 = plList();
        if(ei >= 0 && ei < pl0.length) editIdx = ei;
    }

    setPageHeader(page, editIdx != null ? tr('Modifica playlist') : tr('Aggiungi playlist'));
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/settingsui.view";
    setLoading(page, true);

    // valori del form: playlist in modifica oppure credenziali attive
    var src = (editIdx != null) ? plList()[editIdx] : null;
    var form = {
        plType:   src ? (src.t || 'xtream') : (cfg.plType || 'xtream'),
        playName: src ? src.n : (cfg.playName || 'XCtv'),
        server:   src ? src.s : (cfg.server || ''),
        username: src ? src.u : (cfg.username || ''),
        password: src ? src.p : (cfg.password || ''),
        epgUrl:   src ? src.e : (cfg.epgUrl || '')
    };

    var PLTYPES = { xtream: 'Xtream Codes', m3u: 'M3U', stalker: 'Stalker' };

    var nodes = {};

    function row(id, title, value, hint) {
        var n = optRow(page, { id: id, kind: 'text',
                               title: title, value: value, hint: hint });
        nodes[id] = n;
    }

    function typeHints() {
        var t = form.plType;
        var hints = {
            server:   t == 'm3u' ? tr('URL del file lista .m3u/.m3u8') :
                      t == 'stalker' ? tr('URL del portale') :
                      'host:porta o URL del pannello Xtream',
            username: t == 'stalker' ? tr('MAC address (aa:bb:cc:dd:ee:ff)') :
                      t == 'm3u' ? tr('Non richiesto') : '',
            password: t != 'xtream' ? tr('Non richiesta') : ''
        };
        if(nodes.server)   nodes.server.metadata.hint = hints.server;
        if(nodes.username) nodes.username.metadata.hint = hints.username;
        if(nodes.password) nodes.password.metadata.hint = hints.password;
    }

    var groups = [{ id: 'pl', title: tr('Playlist') }];
    var g = prop.createRoot();
    g.metadata = { title: tr('Playlist') };
    g.xidx = 0;
    g.sel = 1;
    prop.setParent(g, page.model.groups);

    var typen = optRow(page, { id: 'pltype', kind: 'choice',
                               title: tr('Tipo'),
                               value: PLTYPES[form.plType] });
    nodes['pltype'] = typen;

    row('playName', tr('Nome playlist'), form.playName);
    row('server',   tr('Server'),        form.server,
        tr('host:porta o URL del pannello Xtream'));
    row('username', tr('Username'),      form.username);
    row('password', tr('Password'),      form.password ? '••••••' : '');
    row('epgUrl',   tr('URL EPG (opzionale)'), form.epgUrl,
        tr('Vuoto = xmltv.php del server / url-tvg della lista'));
    typeHints();

    var add = optRow(page, { id: 'add', kind: 'action',
                             title: tr('Aggiungi playlist') });
    nodes['add'] = add;
    var cancel = optRow(page, { id: 'cancel', kind: 'action',
                                title: tr('Annulla') });
    nodes['cancel'] = cancel;

    prop.subscribe(page.model.eventSink, function(type, val) {
        try {
            if(type != 'action' || prop.isZombie(page.root)) return;
            if(val.indexOf('opt:') != 0) return;

            var id = val.substr(4);

            if(id == 'cancel') {
                page.redirect(plugin.id + ':start');
                return;
            }

            if(id == 'pltype') {
                var tseq = ['xtream', 'm3u', 'stalker'];
                var ti = tseq.indexOf(form.plType);
                form.plType = tseq[(ti + 1) % tseq.length];
                typen.metadata.value = PLTYPES[form.plType];
                typeHints();
                return;
            }

            if(id == 'add') {

                if(!form.server) {
                    popup.notify(tr('Il server/URL e\' obbligatorio'), 3);
                    return;
                }
                if(form.plType == 'xtream' && !form.username) {
                    popup.notify(tr('Username obbligatorio per Xtream'), 3);
                    return;
                }
                if(form.plType == 'stalker' &&
                   !/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(form.username)) {
                    popup.notify(tr('Inserisci la MAC (aa:bb:cc:dd:ee:ff)'), 3);
                    return;
                }

                // cfg subito (callback asincrone) + model per persistenza
                cfg.plType = form.plType;
                cfg.playName = form.playName;
                cfg.server = form.server;
                cfg.username = form.username;
                cfg.password = form.password;
                cfg.epgUrl = form.epgUrl;

                setName.model.value = form.playName;
                setServer.model.value = form.server;
                setUser.model.value = form.username;
                setPass.model.value = form.password;
                setEpgUrl.model.value = form.epgUrl;

                var finish = function(res) {
                    if(!res || !res.status) {
                        popup.notify(tr('Connessione fallita') + ': ' +
                            (res ? res.error : '?'), 4);
                        return;
                    }

                    var savedIdx = savePlEntry(form.playName, form.server,
                                               form.username, form.password,
                                               form.epgUrl, editIdx,
                                               form.plType);
                    applyPlaylist(savedIdx);
                    popup.notify(editIdx != null ? tr('Playlist aggiornata') :
                                                   tr('Playlist aggiunta'), 2);
                    page.redirect(plugin.id + ':start');
                };

                var fp = makeProvider(form.plType, form);
                if(fp.checkLoginAsync) {
                    popup.notify(tr('Verifica in corso…'), 2);
                    fp.checkLoginAsync(finish);
                } else {
                    finish(fp.checkLogin());
                }
                return;
            }

            // campo testuale
            var r = popup.textDialog(nodes[id].metadata.title + ':', true, true);
            if(r.rejected) return;
            var v = (r.input == null) ? '' : String(r.input);
            form[id] = v;
            nodes[id].metadata.value =
                (id == 'password' && v) ? '••••••' : v;
        } catch(e) {
            console.log('xctv: addplaylist: ' + e);
        }
    }, {
        autoDestroy: true,
    });

    setLoading(page, false);
}

new page.Route(plugin.id + ":addplaylist", function(page) {
    addPlaylistPage(page, null);
});

new page.Route(plugin.id + ":addplaylist:(.*)", function(page, idx) {
    addPlaylistPage(page, idx);
});


/*
 *  Login action shown in the page side menu
 */
function login(page) {

    page.options.createAction('Login', 'Login', function() {
        loginPopup();
        page.flush();
        page.redirect(plugin.id + ':start');
    });

}


// Istances
service.create(plugin.id, plugin.id + ":start", "tv", true, logo);


/*
 *  Searcher — cerca in live, film e serie
 */
new page.Searcher('XCtv', logo, function(page, query) {
    xctvSearch(page, query);
});

// Pagina risultati interna — la SearchBar della pagina Cerca naviga
// qui invece che alla ricerca globale search: (che aggrega tutti i
// plugin). La ricerca globale resta registrata via page.Searcher.
new page.Route(plugin.id + ":results:(.*)", function(page, query) {

    query = decodeURIComponent(query);
    setPageHeader(page, tr('Cerca') + ': ' + query);
    page.type = 'directory';
    setLoading(page, true);
    try {
        xctvSearch(page, query);
    } catch(e) {
        console.log('xctv: results route error: ' + e);
    }
    setLoading(page, false);
});

function xctvSearch(page, query) {

    query = query.toLowerCase();
    page.type = 'directory';

    var hits = 0;

    function match(s) {
        return s && s.toLowerCase().indexOf(query) != -1;
    }

    // niente contenuti di gruppi nascosti/bloccati nei
    // risultati (ne' canali nascosti singolarmente)
    var bml = blockedCatMap('live', cacheGet('livecats'));
    var bmv = blockedCatMap('vod', cacheGet('vodcats'));
    var bms = blockedCatMap('series', cacheGet('seriescats'));

    // come vod/series: niente fetch sync durante la digitazione;
    // a cache fredda parte uno scan per-categoria filtrato sul
    // titolo — accumula solo i match, non il catalogo intero
    var live = cacheGet('livestreams');
    if(live) {
        for(var i = 0; i < live.length && hits < 200; i++) {
            if(bml[String(live[i].cat_id)] ||
               isHiddenChan(live[i].source.url)) continue;
            applyRename(live[i]);
            if(match(live[i].title)) {
                var it = page.appendItem(plugin.id + ':playlive:' + encodeURIComponent(live[i].title) + ':' + encodeURIComponent(live[i].source.url), 'video', live[i]);
                fillChannelEpg(it, live[i], false);
                hits++;
            }
        }
    } else {
        var la = api();
        wholeByCats('live', la, {
            limit: 200 - hits,
            keep: function(it) {
                return !bml[String(it.cat_id)] &&
                       !isHiddenChan(it.source.url) &&
                       match(it.title);
            }
        }, function(l) {
            if(!l || prop.isZombie(page.root)) return;
            for(var i = 0; i < l.length; i++) {
                applyRename(l[i]);
                var it2 = page.appendItem(plugin.id + ':playlive:' +
                    encodeURIComponent(l[i].title) + ':' +
                    encodeURIComponent(l[i].source.url), 'video', l[i]);
                fillChannelEpg(it2, l[i], false);
            }
        });
    }

    // cacheGet: la ricerca non scarica il catalogo intero in
    // sync (decine di MB = freeze). Se assente parte uno scan
    // per-categoria filtrato sul titolo: accumula solo i match
    // (max 200), mai il catalogo intero — e i risultati si
    // appendono appena lo scan finisce.
    var vod = cacheGet('vodstreams');
    if(vod) {
        for(var i = 0; i < vod.length && hits < 200; i++) {
            if(bmv[String(vod[i].cat_id)] ||
               isHiddenBrowseItem('vod', vod[i].id)) continue;
            if(match(vod[i].title)) {
                page.appendItem(plugin.id + ':vodinfo:' + encodeURIComponent(vod[i].title) + ':' + vod[i].id, 'directory', vod[i]);
                hits++;
            }
        }
    } else {
        var va = api();
        wholeByCats('vod', va, {
            limit: 200 - hits,
            keep: function(it) {
                return !bmv[String(it.cat_id)] &&
                       !isHiddenBrowseItem('vod', it.id) &&
                       match(it.title);
            }
        }, function(l) {
            if(!l || prop.isZombie(page.root)) return;
            for(var i = 0; i < l.length; i++)
                page.appendItem(plugin.id + ':vodinfo:' +
                    encodeURIComponent(l[i].title) + ':' + l[i].id,
                    'directory', l[i]);
        });
    }

    var series = cacheGet('series');
    if(series) {
        for(var i = 0; i < series.length && hits < 200; i++) {
            if(bms[String(series[i].cat_id)] ||
               isHiddenBrowseItem('series', series[i].id)) continue;
            if(match(series[i].title)) {
                page.appendItem(plugin.id + ':seriesinfo:' + encodeURIComponent(series[i].title) + ':' + series[i].id, 'directory', series[i]);
                hits++;
            }
        }
    } else {
        var sa = api();
        wholeByCats('series', sa, {
            limit: 200 - hits,
            keep: function(it) {
                return !bms[String(it.cat_id)] &&
                       !isHiddenBrowseItem('series', it.id) &&
                       match(it.title);
            }
        }, function(l) {
            if(!l || prop.isZombie(page.root)) return;
            for(var i = 0; i < l.length; i++)
                page.appendItem(plugin.id + ':seriesinfo:' +
                    encodeURIComponent(l[i].title) + ':' + l[i].id,
                    'directory', l[i]);
        });
    }
}


/*
 *  Play
 */
new page.Route(plugin.id + ":play:(.*):(.*)", function(page, title, url) {

    setLoading(page, false);
    page.type = 'video';

    // cronologia "Continua a guardare": solo film/episodi
    try {
        var du = decodeURIComponent(url);
        var kind = du.indexOf('/movie/') >= 0 ? 'vod' :
                   (du.indexOf('/series/') >= 0 ? 'series' : null);
        if(kind) {
            var icon = '';
            var src = kind == 'vod' ? cacheGet('vodstreams') : null;
            if(kind == 'vod' && src)
                for(var hi = 0; hi < src.length; hi++)
                    if(src[hi].source && src[hi].source.url == du) {
                        icon = src[hi].icon || '';
                        break;
                    }
            histAdd(decodeURIComponent(title), icon, du, kind);
        }
    } catch(e) {}

    var du2 = decodeURIComponent(url);
    page.source = "videoparams:" + JSON.stringify({
        title: decodeURIComponent(title),
        canonicalUrl: plugin.id + ':play:' + decodeURIComponent(title) + ':' + decodeURIComponent(url),
        sources: [{url:  du2}],
        // sub scan disattivo solo sui live (rallenta lo zapping):
        // su VOD/serie/catch-up serve per trovare le tracce sub
        no_subtitle_scan: du2.indexOf('/live/') != -1,
        // canale live Xtream: niente prompt "continua/riavvia" —
        // il resume resta solo per contenuti on-demand.
        live: du2.indexOf('/live/') != -1
    });

});


/*
 *  Play Live — come :play: ma il chiamante garantisce che e' un
 *  canale live: live:true + no_subtitle_scan anche quando l'URL
 *  non contiene '/live/' (playlist M3U/Stalker). Le righe live
 *  e i risultati ricerca live puntano qui.
 */
new page.Route(plugin.id + ":playlive:(.*):(.*)", function(page, title, url) {

    setLoading(page, false);
    page.type = 'video';

    var du = decodeURIComponent(url);
    page.source = "videoparams:" + JSON.stringify({
        title: decodeURIComponent(title),
        canonicalUrl: plugin.id + ':playlive:' +
            decodeURIComponent(title) + ':' + du,
        sources: [{url: liveTransportUrl(du)}],
        no_subtitle_scan: true,
        live: true
    });

});


/*
 *  Catch-up diretto — riproduce la finestra programma
 *  (dal palinsesto) con l'URL timeshift Xtream.
 */
new page.Route(plugin.id + ":playcatchup:(.*):(.*):(.*):(.*)", function(page, title, stream_id, start, stop) {

    setLoading(page, false);
    page.type = 'video';

    var url = api().getCatchupUrl(stream_id, parseInt(start, 10),
                                  Math.max(1, Math.ceil((stop - start) / 60)));

    page.source = "videoparams:" + JSON.stringify({
        title: decodeURIComponent(title),
        canonicalUrl: plugin.id + ':playcatchup:' + title + ':' + stream_id +
                      ':' + start + ':' + stop,
        sources: [{url: url}],
        no_subtitle_scan: false   // catch-up = VOD: i sub servono
    });
});


/*
 *  Series info (episodes)
 */
// Ordinamento stabile episodi: stagione → numero → titolo.
// Usato sia dalla pagina serie sia da :playep:/autoplay per
// trovare "l'episodio successivo" nello stesso ordine.
function seriesSort(eps) {
    eps.sort(function(a, b) {
        var sa = a.season && a.season.number != null ? parseFloat(a.season.number) : 0;
        var sb = b.season && b.season.number != null ? parseFloat(b.season.number) : 0;
        if(sa != sb) return sa - sb;
        var ea = a.episode && a.episode.number != null ? parseFloat(a.episode.number) : 0;
        var eb = b.episode && b.episode.number != null ? parseFloat(b.episode.number) : 0;
        if(ea != eb) return ea - eb;
        return String(a.title || '').localeCompare(String(b.title || ''));
    });
    return eps;
}

// canonical url episodio: identifica univocamente la puntata
// (watched store + autoplay next + resume posizione)
function playepUrl(series_id, epid) {
    return plugin.id + ':playep:' + series_id + ':' + epid;
}

new page.Route(plugin.id + ":seriesinfo:(.*):(.*)", function(page,title,series_id) {
    title = decodeURIComponent(title);

    setPageHeader(page, title);
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/episodes.view";
    setLoading(page, true);
    page.model.loadingStatus = tr('Caricamento…');

    // metadati della serie (poster, trama) dalla cache generale —
    // cacheGet: niente download sync del catalogo solo per la trama
    try {
        var all = cacheGet('series');
        if(all)
            for(var i = 0; i < all.length; i++)
                if(String(all[i].id) == String(series_id)) {
                    page.metadata.poster = all[i].icon;
                    page.metadata.genre = all[i].genre;
                    page.metadata.year = all[i].year;
                    page.metadata.description = all[i].description;
                    break;
                }
    } catch(e) {}

    function build(series) {

        if(prop.isZombie(page.root)) return;
        series = seriesSort(series || []);

        // Rail stagioni : "Tutti" + Stagione N
        // in page.model.groups; il cambio stagione e' in-place
        // via eventSink "group:N" come le categorie browse.
        var seasons = [];
    var seen = {};
    for(var i = 0; i < series.length; i++) {
        var sn = series[i].season && series[i].season.number != null ?
            series[i].season.number : 0;
        if(seen[sn]) continue;
        seen[sn] = 1;
        seasons.push({ id: String(sn), title: tr('Stagione') + ' ' + sn });
    }
    seasons.sort(function(a, b) { return parseInt(a.id, 10) - parseInt(b.id, 10); });

    function epLoader(cat, done) {

        prop.deleteChilds(page.model.nodes);

        // la mappa watched si legge una volta per fill, non per
        // episodio (watchStore.map e' un getter del proxy)
        var wmap = hidMap(watchStore);
        var n = 0;
        for(var i = 0; i < series.length; i++) {
            var sn = series[i].season && series[i].season.number != null ?
                String(series[i].season.number) : '0';
            if(cat != 'all' && sn != cat) continue;
            var cu = playepUrl(series_id, series[i].id);
            series[i].watched = (wmap[cu] || watchStore[cu]) ? 1 : 0;
            page.appendItem(cu, 'video', series[i]);
            n++;
        }
        if(!n)
            page.appendPassiveItem('separator', '', {
                title: tr('Nessun elemento') });
        if(done) done(null, n);
        return { count: n };
    }

        // kind 'eps': nessuna collisione PIN/nascosti con le
        // categorie serie ('series:id' ha un id diverso dalla
        // stagione numerica)
        var groups = fillRail(page, seasons, 'all', 'eps');
        hookBrowse(page, groups, epLoader, 'all', true, 'eps', seasons);
        setLoading(page, false);
    }

    // fetch async: la pagina resta col loader finche' non
    // arrivano gli episodi (la sync bloccava l'apertura)
    var a = api();
    if(a.getSeriesInfoAsync) {
        a.getSeriesInfoAsync(series_id, function(eps) {
            try {
                if(prop.isZombie(page.root)) return;
                if(!eps) {
                    setLoading(page, false);
                    prop.deleteChilds(page.model.nodes);
                    page.appendPassiveItem('separator', '', {
                        title: tr('Caricamento fallito — riprova') });
                    return;
                }
                build(eps);
            } catch(e) {
                try { setLoading(page, false); } catch(e2) {}
            }
        });
    } else {
        try { build(a.getSeriesInfo(series_id)); }
        catch(e) { setLoading(page, false); }
    }

});


/*
 *  Playep — riproduce un episodio di serie. Il canonicalUrl
 *  xctv:playep:<sid>:<epid> permette marker "visto" e autoplay
 *  del successivo (hook videoscrobble).
 */
new page.Route(plugin.id + ":playep:(.*):(.*)", function(page, series_id, epid) {

    page.type = 'video';
    setLoading(page, true);

    function fail() {
        popup.notify(tr('Episodio non trovato'), 3);
        try {
            page.redirect(plugin.id + ':seriesinfo:' +
                          encodeURIComponent('') +
                          ':' + encodeURIComponent(series_id));
        } catch(e) {}
    }

    function start(eps) {

        if(prop.isZombie(page.root)) return;
        var ep = null;
        for(var i = 0; i < eps.length; i++)
            if(String(eps[i].id) == epid) { ep = eps[i]; break; }

        if(!ep) { fail(); return; }

        var st = ep.season && ep.season.number != null ? ep.season.number : '';
        var en = ep.episode && ep.episode.number != null ? ep.episode.number : '';
        setLoading(page, false);
        page.source = 'videoparams:' + JSON.stringify({
            title: 'S' + st + 'E' + en + ' — ' + ep.title,
            canonicalUrl: playepUrl(series_id, epid),
            sources: [{ url: ep.source.url }],
            no_subtitle_scan: false   // episodi: i sub servono
        });
    }

    // async: l'autoplay e il click episodio non bloccano piu'
    // l'apertura in attesa della get_series_info
    var a = api();
    if(a.getSeriesInfoAsync) {
        a.getSeriesInfoAsync(series_id, function(eps) {
            try {
                if(!eps) { fail(); return; }
                start(seriesSort(eps));
            } catch(e) { fail(); }
        });
    } else {
        try { start(seriesSort(a.getSeriesInfo(series_id) || [])); }
        catch(e) { fail(); }
    }
});


/*
 *  Series Streams
 */
new page.Route(plugin.id + ":seriesstreams:(.*):(.*)", function(page,title,cat_id) {
    page.redirect(plugin.id + ':seriesbrowse:Serie TV:' + cat_id);
});


/*
 *  Series Categories
 */
new page.Route(plugin.id + ":seriescategories:(.*)", function(page,title) {
    // Le categorie serie non hanno pagina separata: il rail e'
    // dentro la sezione. Reindirizza alla browse unificata.
    page.redirect(plugin.id + ':seriesbrowse:Serie TV');
});


/*
 *  Vod info — pagina dettaglio film
 */
new page.Route(plugin.id + ":vodinfo:(.*):(.*)", function(page,title,vod_id) {

    title = decodeURIComponent(title);
    setPageHeader(page, title);
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/moviedetail.view";
    setLoading(page, true);
    page.model.loadingStatus = tr('Caricamento…');

    function build(vod) {

        if(prop.isZombie(page.root)) return;
        setLoading(page, false);

        if(vod) {

            // metadati pagina per moviedetail.view
            page.metadata.poster = vod.icon;
            page.metadata.backdrop = vod.backdrop || vod.icon;
            page.metadata.tagline = vod.tagline;
            page.metadata.genre = vod.genre;
            page.metadata.year = vod.year;
            page.metadata.duration = vod.duration;
            page.metadata.description = vod.description;

            page.appendItem(plugin.id + ':play:' + encodeURIComponent(vod.title) + ':' + encodeURIComponent(vod.source.url), 'video', vod);
        } else {
            page.appendPassiveItem('separator', '', { title: tr('Informazioni non disponibili') });
        }
    }

    // fetch async: il click sul poster non blocca piu' l'apertura
    // in attesa della get_vod_info
    var a = api();
    if(a.getVodInfoAsync) {
        a.getVodInfoAsync(vod_id, function(vod) {
            try { build(vod); }
            catch(e) { try { setLoading(page, false); } catch(e2) {} }
        });
    } else {
        try { build(a.getVodInfo(vod_id)); }
        catch(e) { setLoading(page, false); }
    }

});


/*
 *  Vod Streams
 */
new page.Route(plugin.id + ":vodstreams:(.*):(.*)", function(page,title,cat_id) {
    page.redirect(plugin.id + ':vodbrowse:Film:' + cat_id);
});


/*
 *  Vod Categories
 */
new page.Route(plugin.id + ":vodcategories:(.*)", function(page,title) {
    page.redirect(plugin.id + ':vodbrowse:Film');
});


/*
 *  Live Tv Streams (per category)
 */
new page.Route(plugin.id + ":livestreams:(.*):(.*)", function(page,title,cat_id) {

    setPageHeader(page, decodeURIComponent(title));
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/livetv.view";
    setLoading(page, true);
    page.model.loadingStatus = tr('Caricamento…');

    var groups = [];
    groups = fillLiveGroups(page, groups, cat_id, cacheGet('livecats'));
    fillAppMenu(page, 'live');
    var hk = hookZap(page, groups, liveLoader(page, groups), cat_id);
    // categorie in async: il rail si riempie quando arrivano,
    // il loader lo governa il primo load
    liveCats(function(cats) {
        if(cats && hk) hk.refill(cats);
    });
});


/*
 *  All Live Tv Streams
 */
new page.Route(plugin.id + ":alllivestreams:(.*)", function(page,title) {

    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/livetv.view";
    setLoading(page, true);
    page.model.loadingStatus = tr('Caricamento…');

    var groups = [];
    groups = fillLiveGroups(page, groups, null, cacheGet('livecats'));
    fillAppMenu(page, 'live');
    var hk2 = hookZap(page, groups, liveLoader(page, groups), null);
    liveCats(function(cats) {
        if(cats && hk2) hk2.refill(cats);
    });
});


/*
 *  Multi-view — mosaico 2x2 di canali simultanei. Ogni tile e' un
 *  widget(video) indipendente con noAudio: le pipe silenziose non
 *  rivendicano il primary e non si fermano a vicenda (il runtime
 *  ferma solo la pipe primary precedente — i tile restano vivi).
 *  "mvtune:N" mette il canale N nel primo tile libero (o cicla),
 *  "mvwatch:N" apre il canale del tile nella pagina live unica.
 */
new page.Route(plugin.id + ":multiview", function(page) {

    setPageHeader(page, tr('Multi-view'));
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/multiview.view";
    page.model.loadingStatus = tr('Caricamento…');
    setLoading(page, true);

    var m = page.model;
    m.palpha = (cfg.panelAlpha || 85) / 100;
    var mvUrls = [null, null, null, null];
    var mvStreams = [null, null, null, null];
    var mvHeld = [null, null, null, null];
    for(var ti = 0; ti < 4; ti++) {
        m['mvurl' + ti] = '';
        m['mvtitle' + ti] = '';
        m['mvhas' + ti] = 0;
    }
    m.mvfocus = 0;

    var groups = [];
    groups = fillLiveGroups(page, groups, null, cacheGet('livecats'));
    var loader = liveLoader(page, groups);
    var mstreams = [];
    // "Tutti i canali" nella rail — la callback arriva subito a
    // cache calda o al termine della fetch: i tile si sintonizzano
    // solo quando la lista e' pronta (mvtune guarda mstreams)
    loader(null, function(lr) {
        try {
            if(lr && lr.streams) mstreams = lr.streams;
            setLoading(page, false);
        } catch(e) {}
    });

    function tuneTile(t, s) {
        if(t < 0 || t > 3 || !s || !s.source || !s.source.url) return;
        var canon = plugin.id + ':play:' + encodeURIComponent(s.title) +
                    ':' + encodeURIComponent(s.source.url);
        mvUrls[t] = 'videoparams:' + JSON.stringify({
            title: s.title,
            canonicalUrl: canon,
            sources: [{ url: s.source.url }],
            live: true
        });
        mvStreams[t] = s;
        m['mvurl' + t] = mvUrls[t];
        m['mvtitle' + t] = s.title;
        m['mvhas' + t] = 1;
    }

    prop.subscribe(page.model.eventSink, function(type, val) {
        try {
            if(type != 'action' || prop.isZombie(page.root)) return;
            if(val.indexOf('mvtune:') == 0) {
                var ci = parseInt(val.substr(7), 10);
                if(!mstreams[ci]) return;
                // primo tile libero, altrimenti rimpiazza a rotazione
                var slot = -1;
                for(var t2 = 0; t2 < 4; t2++)
                    if(!mvUrls[t2]) { slot = t2; break; }
                if(slot < 0) {
                    slot = m.mvfocus || 0;
                    m.mvfocus = (slot + 1) % 4;
                }
                tuneTile(slot, mstreams[ci]);
            } else if(val.indexOf('mvwatch:') == 0) {
                var wi = parseInt(val.substr(8), 10);
                var sj = mvStreams[wi];
                if(!sj) return;
                // la pagina live si apre sul canale del tile
                // (redirect: i tile si fermano, il player unico
                // riparte da lastChan). lastGroup = gruppo del
                // canale: senza, il restore lo cerca solo nella
                // prima categoria e sintonizza il canale sbagliato
                uiStore.lastChan = sj.source.url;
                uiStore.lastGroup = (sj.cat_id != null) ? sj.cat_id : null;
                page.redirect(plugin.id + ':alllivestreams:Guida TV');
            }
        } catch(e) {}
    }, { autoDestroy: true });

    // stesso guard della pagina live: ferma i tile quando la
    // pagina non e' corrente, li ripristina al ritorno
    page.root.mvlive = 1;
    var myUrl2 = String(page.root.url);
    var guard2 = setInterval(function() {
        try {
            if(prop.isZombie(page.root)) {
                clearInterval(guard2);
                return;
            }
            if(currentPageUrl() == myUrl2) {
                for(var t3 = 0; t3 < 4; t3++) {
                    var cur3 = String(m['mvurl' + t3] || '');
                    if(mvHeld[t3] !== null && !cur3) {
                        m['mvurl' + t3] = mvHeld[t3];
                        mvHeld[t3] = null;
                    }
                }
            } else {
                for(var t4 = 0; t4 < 4; t4++) {
                    var cur4 = String(m['mvurl' + t4] || '');
                    if(cur4) { mvHeld[t4] = cur4; m['mvurl' + t4] = ''; }
                }
            }
        } catch(e) {}
    }, 1000);
});


/*
 *  Channel EPG — palinsesto completo di un canale
 */
new page.Route(plugin.id + ":chanepg:(.*):(.*):(.*)", function(page,title,stream_id,epgid) {

    title = decodeURIComponent(title);
    epgid = decodeURIComponent(epgid);
    setPageHeader(page, title);
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/schedule.view";
    page.model.loadingStatus = tr('Caricamento…');
    setLoading(page, true);

    ensureGuide(function(ok) {

        try {

            if(prop.isZombie(page.root)) return;

            var now = Math.floor(Date.now() / 1000);
            var evs = [];

            if(ok && guideFresh()) {
                evs = guide.eventsFor(epgid || title, now - 12 * 3600, now + 48 * 3600);
            }

            // offset orario EPG — allineato alla griglia live e al
            // catch-up (la finestra passata a playcatchup contiene
            // gia' i tempi corretti)
            evs = shiftEvs(evs);

            var go = function() {

            if(!evs.length) {
                page.appendPassiveItem('separator', '', { title: tr('Nessuna informazione palinsesto per questo canale') });
            }

            // il canale ha un archivio? i programmi finiti diventano
            // riproducibili via catch-up — lookup per id (scan
            // per-categoria filtrato), niente catalogo intero
            liveById(stream_id, function(sref) { try {

            if(prop.isZombie(page.root)) return;

            var hasArchive = !!(sref && sref.archive);

            var surl = sref && sref.source ? sref.source.url : '';
            for(var i = 0; i < evs.length; i++) {
                var e = evs[i];
                var isFuture = e.start > now;
                var meta = {
                    title: e.title,
                    description: e.desc,
                    start: e.start,
                    stop: e.stop,
                    isCurrent: (e.start <= now && e.stop > now) ? 1 : 0,
                    canReplay: (hasArchive && e.stop <= now) ? 1 : 0,
                    canSched: (isFuture && surl) ? 1 : 0,
                    isSched: (isFuture && surl && schedFind(surl, e.start) >= 0) ? 1 : 0
                };
                if(meta.canReplay)
                    page.appendItem(plugin.id + ':playcatchup:' +
                        encodeURIComponent(title) + ':' + stream_id + ':' +
                        e.start + ':' + e.stop, 'video', meta);
                else if(meta.canSched) {
                    page.appendItem(plugin.id + ':schedrec:' +
                        encodeURIComponent(title) + ':' + stream_id + ':' +
                        encodeURIComponent(epgid) + ':' +
                        e.start + ':' + e.stop + ':' +
                        encodeURIComponent(e.title || ''), 'video', meta);
                    page.appendItem(plugin.id + ':evact:' +
                        encodeURIComponent(title) + ':' + stream_id + ':' +
                        encodeURIComponent(epgid) + ':' +
                        e.start + ':' + e.stop + ':' +
                        encodeURIComponent(e.title || ''), 'action', {
                        title: tr('Promemoria e registrazione serie'),
                        description: remFind(e.start, stream_id) >= 0 ?
                            tr('Promemoria attivo') : ''
                    });
                } else
                    page.appendPassiveItem('event', '', meta);
            }

            setLoading(page, false);

            } catch(e2) { console.log('xctv: chanepg items: ' + e2); }
            });

            };

            // niente eventi in guida -> short_epg async come
            // fallback (era un _req bloccante)
            if(!evs.length) {
                var fellBack = false;
                try {
                    if(api().getShortEpgAsync) {
                        fellBack = true;
                        api().getShortEpgAsync(stream_id, 100, function(sevs) {
                            evs = sevs || [];
                            go();
                        });
                    }
                } catch(e3) { fellBack = false; }
                if(!fellBack) {
                    try { evs = api().getShortEpg(stream_id, 100); }
                    catch(e4) { evs = []; }
                    go();
                }
            } else go();

        } catch(e) {
            console.log('xctv: chanepg: ' + e);
        }
    });

});


/*
 *  Schedrec — attiva/disattiva una registrazione programmata
 *  dal palinsesto, poi torna alla pagina del canale.
 */
new page.Route(plugin.id + ":schedrec:(.*):(.*):(.*):(.*):(.*):(.*)",
    function(page, chantitle, stream_id, epgid, start, stop, evtitle) {

    var ct = decodeURIComponent(chantitle);
    var evt = decodeURIComponent(evtitle);
    var st = parseInt(start, 10), sp = parseInt(stop, 10);

    liveById(stream_id, function(sref) {

    var surl = sref && sref.source ? sref.source.url : '';

    var list = schedStore.list || [];
    var idx = schedFind(surl, st);
    if(idx >= 0) {
        list.splice(idx, 1);
        schedStore.list = list;
        popup.notify(tr('Registrazione programmata rimossa') + ': ' + evt, 3);
    } else if(surl) {
        list.push({ t: evt, c: ct, u: surl, st: st, sp: sp });
        schedStore.list = list;
        var d = new Date(st * 1000);
        var hh = d.getHours(), mm = d.getMinutes();
        popup.notify(tr('Registrazione programmata') + ': ' + evt + ' ' + tr('alle') + ' ' +
            (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm, 4);
    } else {
        popup.notify(tr('Canale non trovato'), 3);
    }

    page.redirect(plugin.id + ':chanepg:' + chantitle + ':' +
        stream_id + ':' + epgid);
    });
});


/*
 *  Evact — mini-pagina azioni per un programma futuro:
 *  promemoria (solo notifica) e registrazione serie (tutte le
 *  puntate con lo stesso titolo presenti in palinsesto).
 */
new page.Route(plugin.id + ":evact:(.*):(.*):(.*):(.*):(.*):(.*)",
    function(page, chantitle, stream_id, epgid, start, stop, evtitle) {

    var ct = decodeURIComponent(chantitle);
    var evt = decodeURIComponent(evtitle);
    var st = parseInt(start, 10), sp = parseInt(stop, 10);

    setPageHeader(page, evt);
    page.type = 'directory';

    var hasRem = remFind(st, stream_id) >= 0;
    page.appendItem(plugin.id + ':remtoggle:' + chantitle + ':' +
        stream_id + ':' + epgid + ':' + st + ':' + sp + ':' + evtitle,
        'action', {
        title: (hasRem ? '✓ ' : '') + tr('Promemoria'),
        description: hasRem ? tr('Attivo: sarai avvisato all\'inizio') :
            tr('Avvisami quando inizia')
    });

    // conta gli episodi futuri con lo stesso titolo in palinsesto —
    // short_epg in async (era un _req bloccante se guida non fresca)
    var renderSeries = function(evs2, now2) {
        if(prop.isZombie(page.root)) return;
        var nsame = 0;
        try {
            var want = evt.replace(/\s+/g, ' ').toLowerCase();
            for(var i = 0; i < evs2.length; i++)
                if(evs2[i].start > now2 &&
                   String(evs2[i].title || '').replace(/\s+/g, ' ').toLowerCase() == want)
                    nsame++;
        } catch(e) {}

        if(nsame > 1)
            page.appendItem(plugin.id + ':schedrecseries:' + chantitle + ':' +
                stream_id + ':' + epgid + ':' + evtitle, 'action', {
                title: tr('Registra tutta la serie'),
                description: nsame + ' ' + tr('puntate in palinsesto')
            });
        else
            page.appendPassiveItem('separator', '', {
                title: tr('Registra tutta la serie'),
                description: tr('Nessun\'altra puntata in palinsesto')
            });
    };

    var now2 = Math.floor(Date.now() / 1000);
    if(guideFresh()) {
        try {
            renderSeries(shiftEvs(guide.eventsFor(
                decodeURIComponent(epgid) || ct, now2, now2 + 7 * 86400)),
                now2);
        } catch(e) { renderSeries([], now2); }
    } else {
        var fired = false;
        try {
            if(api().getShortEpgAsync) {
                fired = true;
                api().getShortEpgAsync(stream_id, 200, function(evs2) {
                    renderSeries(evs2 || [], now2);
                });
            }
        } catch(e2) { fired = false; }
        if(!fired)
            try { renderSeries(api().getShortEpg(stream_id, 200), now2); }
            catch(e3) { renderSeries([], now2); }
    }

    page.appendPassiveItem('separator', '', {
        title: tr('Registrazione singola puntata'),
        description: tr('Usa il badge "Registra" sulla riga del programma')
    });
});


/*
 *  Remtoggle — attiva/rimuove il promemoria per un programma.
 */
new page.Route(plugin.id + ":remtoggle:(.*):(.*):(.*):(.*):(.*):(.*)",
    function(page, chantitle, stream_id, epgid, start, stop, evtitle) {

    var ct = decodeURIComponent(chantitle);
    var evt = decodeURIComponent(evtitle);
    var st = parseInt(start, 10), sp = parseInt(stop, 10);
    var rl = (remStore.list || []).slice();
    var idx = remFind(st, stream_id);

    if(idx >= 0) {
        rl.splice(idx, 1);
        remStore.list = rl;
        popup.notify(tr('Promemoria rimosso') + ': ' + evt, 2);
    } else {
        rl.push({ t: evt, c: ct, st: st, sp: sp, sid: stream_id });
        remStore.list = rl;
        popup.notify(tr('Promemoria attivato') + ': ' + evt, 3);
    }

    page.redirect(plugin.id + ':evact:' + chantitle + ':' + stream_id +
                  ':' + epgid + ':' + st + ':' + sp + ':' + evtitle);
});


/*
 *  Schedrecseries — schedula la registrazione di tutte le
 *  puntate future in palinsesto con lo stesso titolo.
 */
new page.Route(plugin.id + ":schedrecseries:(.*):(.*):(.*):(.*)",
    function(page, chantitle, stream_id, epgid, evtitle) {

    var ct = decodeURIComponent(chantitle);
    var eg = decodeURIComponent(epgid);
    var want = decodeURIComponent(evtitle).replace(/\s+/g, ' ').toLowerCase();
    var now = Math.floor(Date.now() / 1000);

    liveById(stream_id, function(sref) {

    var surl = sref && sref.source ? sref.source.url : '';

    var applyEvs = function(evs) {
        var n = 0;
        if(surl) {
        var list = schedStore.list || [];
        for(var i = 0; i < evs.length; i++) {
            var e = evs[i];
            if(e.start <= now) continue;
            if(String(e.title || '').replace(/\s+/g, ' ').toLowerCase() != want)
                continue;
            if(schedFind(surl, e.start) >= 0) continue;
            list.push({ t: e.title || decodeURIComponent(evtitle),
                        c: ct, u: surl, st: e.start, sp: e.stop });
            n++;
        }
        schedStore.list = list;
        }

        popup.notify(n ? tr('Registrazioni programmate') + ': ' + n + ' ' +
                         tr('puntate')
                       : tr('Nessuna puntata futura da registrare'), 3);

        // torna al palinsesto del canale
        page.redirect(plugin.id + ':chanepg:' + chantitle + ':' +
                      stream_id + ':' + epgid);
    };

    // palinsesto: guida in memoria, altrimenti short_epg async
    if(guideFresh()) {
        try {
            applyEvs(shiftEvs(guide.eventsFor(eg || ct, now,
                                            now + 7 * 86400)));
        } catch(e2) { applyEvs([]); }
    } else {
        var fired = false;
        try {
            if(api().getShortEpgAsync) {
                fired = true;
                api().getShortEpgAsync(stream_id, 200, function(evs) {
                    applyEvs(evs || []);
                });
            }
        } catch(e3) { fired = false; }
        if(!fired)
            try { applyEvs(api().getShortEpg(stream_id, 200)); }
            catch(e4) { applyEvs([]); }
    }
    });
});


/*
 *  Recs — registrazioni. Due sezioni: "Completate" elenca i file
 *  .ts indicizzati (OK = riproduci, "Elimina" = cancella il file),
 *  "Programmate" la lista in attesa (OK = cancella la programmazione).
 */
function fmtRecDate(ts) {
    var d = new Date(ts * 1000);
    return d.getDate() + '/' + (d.getMonth() + 1) + ' ' +
        (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
        (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}

new page.Route(plugin.id + ":recs", function(page) {

    setPageHeader(page, tr('Registrazioni'));
    page.type = "directory";

    var fs = require('native/fs');
    var active = (rec && rec.path) || (schedRec && schedRec.path) || '';

    // --- Completate: file .ts dall'indice, piu' recenti in cima ---
    var rl = recListStore.list || [];
    var shown = 0, stale = false;
    for(var ri = rl.length - 1; ri >= 0; ri--) {
        var f = rl[ri];
        var fd = null, sz = -1;
        try {
            fd = fs.open(f.p, 'r');
            sz = fs.fsize(fd);
        } catch(e) {}
        if(fd) try { Core.resourceDestroy(fd); } catch(e2) {}
        if(sz < 0) { stale = true; continue; }
        shown++;
        var running = active == f.p;
        page.appendItem(plugin.id + ':playrec:' + ri, 'video', {
            title: f.t,
            description: (running ? tr('In corso') + ' — ' : '') +
                (sz / 1048576).toFixed(1) + ' MB — ' + fmtRecDate(f.st)
        });
        if(!running)
            page.appendItem(plugin.id + ':delrecfile:' + ri, 'action', {
                title: tr('Elimina') + ': ' + f.t
            });
    }
    if(!shown)
        page.appendPassiveItem('separator', '', {
            title: tr('Nessuna registrazione completata'),
            description: tr('I file .ts registrati appariranno qui')
        });
    if(stale) {
        // file rimossi fuori dal plugin: ripulisce l'indice
        var keep = [];
        for(var ki = 0; ki < rl.length; ki++) {
            try { var kf = fs.open(rl[ki].p, 'r');
                  Core.resourceDestroy(kf); keep.push(rl[ki]); }
            catch(e3) {}
        }
        recListStore.list = keep;
    }

    // --- Programmate ---
    page.appendPassiveItem('separator', '', { title: tr('Registrazioni programmate') });

    var list = schedStore.list || [];
    if(!list.length)
        page.appendPassiveItem('separator', '', {
            title: tr('Nessuna registrazione programmata'),
            description: tr('Apri il palinsesto di un canale e scegli "Registra" su un programma futuro')
        });

    for(var i = 0; i < list.length; i++) {
        var e = list[i];
        var running = schedRec && schedRec.entry.u == e.u &&
            schedRec.entry.st == e.st;
        page.appendItem(plugin.id + ':delrec:' + i, 'video', {
            title: (e.t || tr('Programma')) + ' — ' + (e.c || ''),
            description: (running ? tr('IN CORSO') + ' — ' : '') + fmtRecDate(e.st) +
                (e.fail ? ' — ' + tr('fallita') : '')
        });
    }

    // --- Promemorie ---
    var reml = remStore.list || [];
    page.appendPassiveItem('separator', '', { title: tr('Promemorie') });
    if(!reml.length)
        page.appendPassiveItem('separator', '', {
            title: tr('Nessun promemoria attivo')
        });
    for(var mi = 0; mi < reml.length; mi++) {
        var rme = reml[mi];
        page.appendItem(plugin.id + ':delrem:' + mi, 'action', {
            title: '⏰ ' + (rme.t || tr('Programma')) + ' — ' + (rme.c || ''),
            description: fmtRecDate(rme.st)
        });
    }
    setLoading(page, false);
});


/*
 *  Playrec — riproduce un file .ts registrato (indice reclist).
 */
new page.Route(plugin.id + ":playrec:(.*)", function(page, idx) {
    var rl = recListStore.list || [];
    var f = rl[parseInt(idx, 10)];
    setLoading(page, false);
    if(!f) { page.redirect(plugin.id + ':recs'); return; }
    page.type = 'video';
    page.source = 'videoparams:' + JSON.stringify({
        title: f.t,
        canonicalUrl: plugin.id + ':playrec:' + idx,
        sources: [{ url: f.p }],
        no_subtitle_scan: false   // i .ts possono avere sub DVB
    });
});


/*
 *  Delrecfile — elimina un file registrato (con conferma).
 */
new page.Route(plugin.id + ":delrecfile:(.*)", function(page, idx) {
    var i = parseInt(idx, 10);
    var rl = (recListStore.list || []).slice();
    var f = rl[i];
    if(f && popup.message(tr('Eliminare la registrazione') + ' "' +
                          f.t + '"?', true, true)) {
        try { require('native/fs').unlink(f.p); } catch(e) {}
        rl.splice(i, 1);
        recListStore.list = rl;
        popup.notify(tr('Registrazione eliminata'), 2);
    }
    page.redirect(plugin.id + ':recs');
});


/*
 *  Delrem — rimuove un promemoria.
 */
new page.Route(plugin.id + ":delrem:(.*)", function(page, idx) {
    var rl = (remStore.list || []).slice();
    var i = parseInt(idx, 10);
    if(i >= 0 && i < rl.length) {
        rl.splice(i, 1);
        remStore.list = rl;
        popup.notify(tr('Promemoria rimosso'), 2);
    }
    page.redirect(plugin.id + ':recs');
});


/*
 *  Help — come si usa xctv: elenco delle funzioni e dove
 *  trovarle (menu contestuale, barra player, impostazioni).
 */
new page.Route(plugin.id + ":help", function(page) {

    setPageHeader(page, tr('Guida'));
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/help.view";

    var rows = [
        [tr('Navigazione'),
         tr('Frecce per muoverti, OK/click per confermare. Tasto destro del mouse o long-press (touch/remote) = menu contestuale. ESC/Back = torna indietro.')],

        [tr('Guida TV'),
         tr('I gruppi di canali sono a sinistra, i canali a destra. OK su un canale lo sintonizza; l\'ultimo canale visto riparte all\'apertura se "Riprendi ultimo canale" e\' attivo nelle Impostazioni.')],

        [tr('Preferiti e Recenti'),
         tr('Long-press su un canale → "Preferiti": appare nel gruppo "Preferiti" in cima. I canali guardati finiscono nel gruppo "Recenti", ordinati per ultimo visto.')],

        [tr('Menu canale (long-press)'),
         tr('Guarda, Palinsesto (EPG del giorno), Rivedi, Preferiti, Nascondi canale, Rinomina, Sposta su/giu\' (ordine manuale), Numero canale (numerazione custom), Multi-view.')],

        [tr('Menu gruppo (long-press sul gruppo)'),
         tr('Sposta su/giu\' per riordinare i gruppi, Nascondi gruppo, Ripristina nascosti. L\'ordine e\' persistente.')],

        [tr('Registrazione'),
         tr('Mentre guardi: icona REC nella barra del player (OK sul video mostra/nasconde info e barra) registra il flusso in un file .ts fino allo stop. I file registrati si rivedono e si eliminano da Menu → "Registrazioni"; la cartella di destinazione si cambia in Impostazioni → Riproduzione.')],

        [tr('Registrazione programmata, promemoria e serie'),
         tr('Palinsesto di un canale → programma futuro → badge "Registra" → OK. La riga "Promemoria e registrazione serie" sotto il programma permette anche il solo avviso all\'inizio (senza registrare) e la registrazione di tutte le puntate con lo stesso titolo. Le registrazioni partono da sole e si fermano a fine programma. Una alla volta: registrare mentre guardi un altro canale puo\' fallire se il provider permette 1 sola connessione.')],

        [tr('Rivedi (catch-up)'),
         tr('Disponibile solo se il provider abilita l\'archivio sul canale (flag tv_archive): click diretto su un programma gia\' finito nella griglia guida, long-press sul canale → "Rivedi", oppure badge nel palinsesto. Se il provider non supporta il timeshift la funzione non appare.')],

        [tr('Serie TV'),
         tr('Gli episodi visti hanno il segno di spunta nella lista. A fine puntata parte automaticamente la successiva (disattivabile in Impostazioni → Riproduzione → "Autoplay episodio successivo").')],

        [tr('Zap numerico'),
         tr('Digita il numero del canale coi tasti 0-9 e conferma con OK/Enter. "Numero canale" nel menu contestuale assegna un numero custom.')],

        [tr('Multi-view'),
         tr('Menu → Multi-view: mosaico 2x2 con audio muto; OK su un tile apre il canale a tutto schermo.')],

        [tr('Cerca'),
         tr('Menu → Cerca: cerca tra canali, film e serie.')],

        [tr('Interfaccia'),
         tr('Menu → Impostazioni → Aspetto: colore accento (evidenziature e bordi della guida), opacita\' pannello, numeri canale, loghi. I cambiamenti si applicano subito.')],

        [tr('Nascondere e bloccare'),
         tr('Nascondi canali/gruppi dal menu contestuale; ripristina da Impostazioni o dal menu del gruppo. Con un PIN impostato puoi bloccare categorie intere (menu contestuale sul gruppo).')],

        [tr('Playlist multiple'),
         tr('Impostazioni → Playlist: piu\' account/sorgenti Xtream, M3U o Stalker, switch rapido e backup/ripristino delle preferenze.')]
    ];

    for(var i = 0; i < rows.length; i++)
        page.appendPassiveItem('info', '', {
            title: rows[i][0],
            description: rows[i][1]
        });
});


new page.Route(plugin.id + ":delrec:(.*)", function(page, idx) {
    var list = schedStore.list || [];
    var i = parseInt(idx, 10);
    if(i >= 0 && i < list.length) {
        var e = list[i];
        list.splice(i, 1);
        schedStore.list = list;
        if(schedRec && schedRec.entry.u == e.u &&
           schedRec.entry.st == e.st) {
            schedRec.pump.stop();
            schedRec = null;
        }
        popup.notify(tr('Registrazione programmata rimossa'), 2);
    }
    page.redirect(plugin.id + ':recs');
});


/*
 *  Live Tv Categories
 */
new page.Route(plugin.id + ":livecategories:(.*)", function(page,title) {
    // Le categorie live aprono direttamente la guida: sono il
    // pannello gruppi dentro la pagina live.
    page.redirect(plugin.id + ':alllivestreams:' + encodeURIComponent(title));
});


/*
 *  Info — account e server
 */
new page.Route(plugin.id + ":info:(.*)", function(page, title) {

    setPageHeader(page, decodeURIComponent(title));
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/info.view";
    setLoading(page, true);

    var user = null, server = null, pending = 2;
    var done = function() {
        if(--pending) return;
        try { if(prop.isZombie(page.root)) return; } catch(e) { return; }
        fill();
        setLoading(page, false);
    };
    try {
        var ai = api();
        if(ai.getInfoAsync) {
            ai.getInfoAsync('user',   function(u) { user = u;   done(); });
            ai.getInfoAsync('server', function(s) { server = s; done(); });
        } else {
            user = ai.getInfo('user'); server = ai.getInfo('server');
            pending = 1; done();
        }
    } catch(e) { pending = 1; done(); }

    function fill() {

    if(user) {
        var exp = user.exp_date ? new Date(parseInt(user.exp_date) * 1000) : null;
        page.appendPassiveItem('info', '', { title: tr('Account'), description: user.username || cfg.username });
        page.appendPassiveItem('info', '', { title: tr('Stato'), description: user.status || '?' });
        page.appendPassiveItem('info', '', { title: tr('Scadenza'), description: exp ? exp.toDateString() : '?' });
        page.appendPassiveItem('info', '', { title: tr('Connessioni'), description: (user.active_cons || '0') + ' / ' + (user.max_connections || '?') });
        page.appendPassiveItem('info', '', { title: tr('Trial'), description: user.is_trial == '1' ? 'Si' : 'No' });
        page.appendPassiveItem('info', '', { title: tr('Creato il'), description: user.created_at ? new Date(parseInt(user.created_at) * 1000).toDateString() : '?' });
    }

    if(server) {
        page.appendPassiveItem('info', '', { title: tr('Server'), description: (server.url || cfg.server) + (server.port ? ':' + server.port : '') });
        page.appendPassiveItem('info', '', { title: tr('Protocollo'), description: server.server_protocol || '?' });
        page.appendPassiveItem('info', '', { title: tr('Timezone'), description: server.timezone || '?' });
        page.appendPassiveItem('info', '', { title: tr('Orario server'), description: server.time_now || '?' });
    }

    var g = tr('non caricata');
    if(guide)
        g = Object.keys(guide.byId).length + ' canali, agg. ' +
            new Date(guideFetchedAt * 1000).toLocaleString();
    page.appendPassiveItem('info', '', { title: tr('EPG'), description: g });

    }

});


/*
 *  First page
 *  It shows the menu
 */
new page.Route(plugin.id + ":start", function(page) {

    setPageHeader(page, tr('XCtv'));
    page.type = "directory";
    setLoading(page, true);
    page.model.loadingStatus = tr('Caricamento…');

    syncActivePl();
    applyNetTuning();
    armAutoRefresh();

    // Credenziali assenti o login fallito → schermata di benvenuto:
    // "Aggiungi playlist" + "Impostazioni". Il check e' async:
    // con server irraggiungibile la pagina resta in loading e
    // non si congela il thread ES fino al timeout.
    var decide = function(checkLogin) {

        if(prop.isZombie(page.root)) return;

        if(checkLogin.status) {

            // Il plugin si apre direttamente sulla guida TV
            // (live), non su una home a tessere.
            // epgOnStart: avvia il caricamento della guida SOLO se
            // il TTL (disco/memoria) e' scaduto — niente download
            // forzato ad ogni lancio.
            if(cfg.epgOnStart)
                ensureGuide(function(ok) {});
            page.redirect(plugin.id + ':alllivestreams:Diretta');
            return;
        }

    page.metadata.glwview = Plugin.path + "views/welcome.view";
    setLoading(page, false);

    if(checkLogin.error)
        page.model.errmsg = checkLogin.error;

    var widx = 0;
    function welcomeRow(title, desc, ev) {

        var n = prop.createRoot();
        n.metadata = { title: title, description: desc };
        n.event = ev;
        n.xidx = widx++;
        prop.setParent(n, page.model.nodes);
    }

    // Playlist salvate: accesso rapido anche se il login attivo
    // e' fallito (posso scegliere un'altra playlist)
    var wp = plList();
    for(var pi = 0; pi < wp.length; pi++)
        welcomeRow(tr('Apri') + ' ' + (wp[pi].n || tr('Playlist')),
                   wp[pi].s || '', 'openpl:' + pi);

    welcomeRow(tr('Aggiungi playlist'),
               tr('Configura un server Xtream Codes (host, username, password)'),
               'addplaylist');
    welcomeRow(tr('Impostazioni'),
               tr('EPG, riproduzione, aspetto, controllo genitori'),
               'opensettings');

    prop.subscribe(page.model.eventSink, function(type, val) {
        if(type != 'action' || prop.isZombie(page.root)) return;
        if(val == 'addplaylist') page.redirect(plugin.id + ':addplaylist');
        else if(val == 'opensettings') page.redirect(plugin.id + ':settings');
        else if(val.indexOf('openpl:') == 0) {
            applyPlaylist(parseInt(val.substr(7), 10));
            page.redirect(plugin.id + ':start');
        }
    }, {
        autoDestroy: true,
    });

    };

    if(!(cfg.server && cfg.username)) {
        decide({ status: false, error: '' });
    } else {
        var a0 = api();
        if(a0.checkLoginAsync) {
            a0.checkLoginAsync(function(res) {
                decide(res || { status: false,
                                error: tr('Nessuna risposta dal server') });
            });
        } else {
            try { decide(a0.checkLogin()); }
            catch(e) { decide({ status: false, error: String(e) }); }
        }
    }

});
