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

var html = require('movian/html');
var Xtream = require('./libs/libxtream');
var page = require('movian/page');
var store = require('movian/store');
var service =require('movian/service');
var plugin = JSON.parse(Plugin.manifest);
var popup = require('native/popup');

var logo = Plugin.path + plugin.icon;

function setPageHeader(page, title) {

    if (page.metadata) {
        page.metadata.title = title;
        page.metadata.logo = logo;
    }

}


function login(page, credentials){

    page.options.createAction('Login', 'Login', function() {

        var result = popup.textDialog('Enter the server url:\n' + 'bit.ly:80 or just bit.ly' , true, true);

        if (!result.rejected && result.input) {

            var link = result.input;
            //if (!link.match(/:\/\//))
            //    link = 'http://' + link;
            var result = popup.textDialog('Enter the username:', true, true);

            if (!result.rejected && result.input) {

                var username = result.input;

                var result = popup.textDialog('Enter the password:', true, true);

                if (!result.rejected && result.input) {

                    credentials.server = encodeURIComponent(link);
                    credentials.username = encodeURIComponent(username);
                    credentials.password = encodeURIComponent(result.input);

                    popup.notify("Credentials have been set", 2);
                    page.flush();
                    //                    page.redirect(plugin.id + ':start');
                    page.redirect(plugin.id + ':start');
                }
            }
        }
    });

}


// Istances
service.create(plugin.id, plugin.id + ":start", "tv", true, logo);
var xtream;


var credentials = store.create('credentials');
if (!credentials.server) credentials.server = '';
if (!credentials.username) credentials.username = '';
if (!credentials.password) credentials.password = '';


/*
 * Play
 */
new page.Route(plugin.id + ":play:(.*):(.*)", function(page, title, url) {

    page.loading = false;
    no_subtitle_scan = true;
    page.type = 'video';

    page.source = "videoparams:" + JSON.stringify({
        title: decodeURIComponent(title),
        canonicalUrl: plugin.id + ':play:' + decodeURIComponent(title) + ':' + decodeURIComponent(url),
        sources: [{url:  decodeURIComponent(url)}],
        no_subtitle_scan: no_subtitle_scan
    });

});


/*
 *  Search bar
 *  It redirects for search files
 */
/*    plugin.addURI(plugin.getDescriptor().id + ":zooqlesearch:(.*)", function(page, query) {
        var path= '/search?q=' + query;
        page.redirect(plugin.getDescriptor().id + ":zooqlefiles:Search for " + query + ":" + path );
    });
*/


/*
 *  Series info
 */
new page.Route(plugin.id + ":seriesinfo:(.*):(.*)", function(page,title,series_id) {
    title=decodeURIComponent(title);

    setPageHeader(page, title);
    page.type = "directory";
    //        page.metadata.glwview = Plugin.path + "views/vod/list.view";
    page.loading = true;

    var series = xtream.getSeriesInfo(series_id);

    for(i in series){
       page.appendItem(plugin.id + ':play:'+encodeURIComponent(series[i].title)+':' + encodeURIComponent(series[i].source.url)  , 'video', series[i]);
    }
    page.loading = false;

});


/*
 *  Series Streams
 */
new page.Route(plugin.id + ":seriesstreams:(.*):(.*)", function(page,title,cat_id) {

    title=decodeURIComponent(title);
    setPageHeader(page, title);
    page.loading = true;
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/series/list.view";

    var vod = xtream.getSeriesByCategoryId(cat_id);
    var c = 0;

    if(vod) {
        for (var i in vod) {
                page.appendItem(plugin.id + ':seriesinfo:'+encodeURIComponent(vod[i].title)+':'+ vod[i].id  , 'video', vod[i]);
                c=c+1;
        }
        setPageHeader(page,title + ' ('+ c.toString()+ ' results)');
    }
    page.loading = false;

});


/*
 *  Series Categories
 */
new page.Route(plugin.id + ":seriescategories:(.*)", function(page,title) {

    setPageHeader(page,title);
    page.loading = true;
    page.type = "directory";
    page.model.contents = "grid";

    var series = xtream.getSeriesCategories();

    if(series) {
        for (var i in series) {
            page.appendItem(plugin.id + ':seriesstreams:'+ encodeURIComponent(series[i].title) +':' + series[i].id , 'directory', series[i]);
        }
        setPageHeader(page,title + ' ('+ i.toString()+ ' results)');
    }
    page.loading = false;

});


/*
 *  Vod info
 */
new page.Route(plugin.id + ":vodinfo:(.*):(.*)", function(page,title,vod_id) {

    title=decodeURIComponent(title);
    setPageHeader(page,title);
    page.type = "directory";
    page.metadata.glwview = Plugin.path + "views/vod/list.view";
    page.loading = true;

    var vod = xtream.getVodInfo(vod_id);

    page.appendItem(plugin.id + ':play:'+encodeURIComponent(title)+':' + encodeURIComponent(vod.source.url)  , 'video', vod);
    page.loading = false;

});


/*
 *  Vod Streams
 */
new page.Route(plugin.id + ":vodstreams:(.*):(.*)", function(page,title,cat_id) {

    title = decodeURIComponent(title);
    setPageHeader(page, title);
    page.type = "directory";
    page.model.contents = "grid";
    page.loading = true;

    var vod = xtream.getVodStreamsByCategoryId(cat_id);

    if(vod) {
        for (var i in vod) {
            page.appendItem(plugin.id + ':vodinfo:'+ encodeURIComponent(vod[i].title)+':'+ vod[i].id  , 'directory', vod[i]);
        }
        setPageHeader(page, title + ' ('+ i.toString()+ ' results)');
    }
    page.loading = false;

});


/*
 *  Vod Categories
 */
new page.Route(plugin.id + ":vodcategories:(.*)", function(page,title) {

    setPageHeader(page, title);
    page.type = "directory";
    page.model.contents = "grid";
    page.loading = true;

    var vod = xtream.getVodCategories();

    if(vod) {
        for (var i in vod) {
            page.appendItem(plugin.id + ':vodstreams:'+ encodeURIComponent(vod[i].title) +':' + vod[i].id , 'directory', vod[i]);
        }
        setPageHeader(page, title + ' ('+ i.toString()+ ' results)');
    }
    page.loading = false;

});


/*
 *  Live Tv Streams
 */
new page.Route(plugin.id + ":livestreams:(.*):(.*)", function(page,title,cat_id) {

    title=decodeURIComponent(title);
    setPageHeader(page, title);
    page.type = "directory";
    // page.contents = "list";
    page.metadata.glwview = Plugin.path + "views/live/list.view";
    page.loading = true;

    var live = xtream.getLiveStreamsByCategoryId(cat_id);

    if(live) {
        for (var i in live) {
            page.appendItem(plugin.id + ':play:'+encodeURIComponent(live[i].title)+':' + encodeURIComponent(live[i].source.url) , 'video', live[i]);
        }
        setPageHeader(page, title + ' ('+ i.toString()+ ' results)');
    }
    page.loading = false;

});


/*
 *  Live Tv Categories
 */
new page.Route(plugin.id + ":livecategories:(.*)", function(page,title) {

    setPageHeader(page, title);
    page.type = "directory";
    page.model.contents = "grid";
    page.loading = true;

    var live = xtream.getLiveCategories();

    if(live) {
        for (var i in live) {
            page.appendItem(plugin.id + ':livestreams:'+ encodeURIComponent(live[i].title) +':' + live[i].id , 'directory', live[i]);
        }
        setPageHeader(page,title + ' ('+ i.toString()+ ' results)');
    }
    page.loading = false;

});


/*
 *  First page
 *  It shows the menu
 */
new page.Route(plugin.id + ":start", function(page) {

    setPageHeader(page, 'XCtv');
    page.type = "directory";

    var options = { debug: true};
    var base_url = {player_api: decodeURIComponent(credentials.server), epg: decodeURIComponent(credentials.server)};
    xtream = new Xtream( base_url, {username : decodeURIComponent(credentials.username),password: decodeURIComponent(credentials.password)} , options );

    var checkLogin = xtream.checkLogin();

    if(checkLogin.status) {

        page.model.contents = "grid";
        page.metadata.glwview = Plugin.path + "views/home.view";
        page.loading = true;

        var userInfo = xtream.getInfo('user');
        //var serverInfo = xtream.getInfo('server');
        var date = new Date(userInfo.exp_date*1000)
        var months_arr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        page.appendItem(plugin.id + ':livecategories:Diretta Tv' , 'directory', {title:'Diretta Tv', icon: Plugin.path+ "images/livetv.png"} );
        page.appendItem(plugin.id + ':vodcategories:Film' , 'directory', {title: 'Film', icon: Plugin.path+ "images/vod.png"} );
        page.appendItem(plugin.id + ':seriescategories:Serie' , 'directory', {title:'Serie', icon: Plugin.path+ "images/series.png"} );
        page.appendItem(plugin.id + ':info:Informazioni' , 'directory', {title:'Informazioni', icon: Plugin.path+ "images/info.png"} );
        page.appendPassiveItem('separator','',{title: 'User: '+ userInfo.username + '  Expire Date: '+ date.getDate()+' '+months_arr[date.getMonth()]+' '+date.getFullYear() +'  Active cons: '+ userInfo.active_cons+ '  Max cons: '+ userInfo.max_connections});
        page.appendPassiveItem('separator','','');

//        xtream.getEpg();
    }
    else {

        page.model.contents = "list";
        page.loading = true;

        page.appendItem(plugin.id + ':start' , 'directory', {title:'reload', icon: Plugin.path+ "images/livetv.png"} );
        if(!checkLogin.status){
            page.appendPassiveItem('separator','',{title: checkLogin.error});
        }
        page.appendPassiveItem('separator','',{title: 'Not Logged in, use login button on right menu.'});


    }

    // we have to develop logout button
    login(page, credentials);

    page.loading = false;

});
