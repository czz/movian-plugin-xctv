/**
 *  libxstream is a module for movian
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
var XmlTv = require('./libxmltv');
var html = require('movian/html');

var Xtream = (function () {

    var _BASE_URL = { player_api: undefined, epg: undefined };

    var _OPTIONS = {
                     debug : false,
                     protocol: "http",
                     // port: 80
                   };

    var _CREDENTIALS = {
                     username : undefined,
                     password : undefined,
                   };

    var _ANNOUNCEMENT = { host: 'api-android.whmcssmarters.com',
                          sc  :  '3bcc1524a81f1796ac58cc1091683606',
                          apikey: 'K60b0ad74709c08209e4b5e0efcb7a814'
                        };

    var _USER_AGENT = 'AnonymousIPTVPlayer';

    /* construct */
    function Xtream(base_url, credentials, options) {

        if (options === Object(options) && Object.prototype.toString.call(options) !== '[object Array]') {
            this.options = function () {
                return  {
                          debug : options.debug ? options.debug : _OPTIONS.debug,
                          protocol : options.protocol ? options.protocol : _OPTIONS.protocol,
                        };
            }
        }

        if (credentials === Object(credentials) && Object.prototype.toString.call(credentials) !== '[object Array]') {
            this.credentials = function () {
                return  {
                          username : credentials.username ? credentials.username : _CREDENTIALS.username,
                          password : credentials.password ? credentials.password : _CREDENTIALS.password,
                        };
            };
        }

        if (base_url === Object(base_url) && Object.prototype.toString.call(base_url) !== '[object Array]') {
            this.baseUrl = function () {
                return  {
                          playerApi : this.options().protocol && base_url.player_api ? this.options().protocol + '://' + base_url.player_api : _BASE_URL.player_api,
                          epg : this.options().protocol &&  base_url.epg ? this.options().protocol + '://' +  base_url.epg : _BASE_URL.epg
                        };
            };
        }

        // getter for player url
        this.playerUrl = function () {
            return   this.baseUrl().playerApi + "/player_api.php";
        };

        // getter for player url
        this.epgUrl = function () {
            return  this.baseUrl().epg + "/xmltv.php";
        };

        // getter for user agent
        this.userAgent = function () {
            return  _USER_AGENT;
        };

        // getter for announcements
        this.announcements = function () {
           return _ANNOUNCEMENTS;
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
     * Private method req
     */
    function _req(data, statuscode) {


        switch(statuscode) {
            case true:
        }

        var res = false;
        var post_data = {};

        if (data === Object(data) && Object.prototype.toString.call(data) !== '[object Array]') {
            post_data = data;
        }

        post_data['username']= this.credentials().username;
        post_data['password']= this.credentials().password;

        var s = { method: "POST",
                  debug: this.options().debug,
                  compression: false,
                  headers: { 'User-Agent' : this.userAgent() },
                  postdata: post_data
                 };

        if(!this.credentials().username && !this.credentials().password) return res;

        try {

            var v = http.request(this.playerUrl(), s);

            switch(statuscode) {
                case true:
                    return v.statuscode;
                    break;
                default:
                    return JSON.parse(v.toString());
                    break;
            }

        }
        catch (e) {
            _debug.call(this,  e.toString().replace('\n', ''), 'Xtream' );
        }

        return res;

    }


    function _reqEpg() {

        var res = false;

        if(!this.credentials().username && !this.credentials().password) return res;

        url = this.epgUrl() + "?username=" + this.credentials().username + "&password=" + this.credentials().password;

        var s = { method: "GET",
                  debug: this.options().debug,
                  compression: true,
                  headers: { 'User-Agent' : this.userAgent(), 'Content-Type':'text/xml)' },
                 };


        try {


            // for some reason movian XML parse doesn't work
            // we have made our own xmltv.dtd parser

            var v = http.request(url, s).toString();


//            var xml = new RegExp('<?xml([^>]+)>', 'i').test(v);
            var xmltv = new XmlTv({debug: true});

            //var doctype = xmltv.getDoctype(v);
            //var doctype = xmltv.getXml(v);
            var doctype = xmltv.getChannels(xmltv.getTv(v).content);

//            var tv = new RegExp('<tv([^>]+)>(.*)', 'i').test(v);

            console.log('v:'+ JSON.stringify(doctype));
/*
            return html.parse('<tv generator-info-name="my listings generator">'+
'<channel id="3sat.de">'+
'    <display-name lang="de">3SAT</display-name>'+
 ' </channel>'+
'  <channel id="das-erste.de">'+
'    <display-name lang="de">ARD</display-name>'+
'    <display-name lang="de">Das Erste</display-name>'+
 ' </channel>'+

'  <programme start="200006031633" channel="3sat.de">'+
'    <title lang="de">blah</title>'+
'    <title lang="en">blah</title>'+
'    <desc lang="de">'+
'       Blah Blah Blah.'+
'    </desc>'+
'    <credits>'+
'      <director>blah</director>'+
'      <actor>a</actor>'+
'      <actor>b</actor>'+
'    </credits>'+
'    <date>19901011</date>'+
'    <country>ES</country>'+
'    <episode-num system="xmltv_ns">2 . 9 . 0/1</episode-num>'+
'    <video>'+
'      <aspect>16:9</aspect>'+
'    </video>'+
'    <rating system="MPAA">'+
'      <value>PG</value>'+
'      <icon src="pg_symbol.png" />'+
'    </rating>'+
'    <star-rating>'+
'      <value>3/3</value>'+
'    </star-rating>'+
 ' </programme>'+
'</tv>');
*/

            //var html = require('showtime/html');
            //return html.parse(v).document;

        }
        catch (e) {
            _debug.call(this,  e.toString().replace('\n', ''), 'AnonympusTv:_reqEpg', true );
        }

        return res;

    }

    /*
     *  Get infos of your account
     *  returns oject data
     *
     */
    Xtream.prototype.checkLogin = function () {

        var res = _req.call(this,{},true);

        _debug.call(this, JSON.stringify(res), "Xtream:checkLogin")

        switch(res) {
            case 200:
                return {status : true, error: ''};
                break;
            case 502:
                return {status : false, error: "Bad Gateway" };
                break;
            case 503:
                return {status : false, error: "Service Anavailable" };
                break;
            default:
                return {status : false, error: "Something went wrong, maybe wrong credentials or expired"};
                break;
        }
        return false;


    };


    /*
     *  Get infos of your account
     *  returns oject data
     *
     */
    Xtream.prototype.getInfo = function (action) {

        /*
          {
           "user_info":{"username":"xxxxxxxxxx","password":"xxxxxxxxxx","message":"","auth":1,"status":"Active","exp_date":"1575718849","is_trial":"0","active_cons":"0","created_at":"1573126849","max_connections":"1","allowed_output_formats":["m3u8","ts"]},
           "server_info":{"url":"proxy.ayservices.xyz","port":"80","https_port":"25463","server_protocol":"http","rtmp_port":"25462","timezone":"Europe/Rome","timestamp_now":1574595062,"time_now":"2019-11-24 12:31:02"}
          }
        */

        var res = _req.call(this);

        _debug.call(this, JSON.stringify(res), "Xtream:getInfo")

        if(!res) return false;

        switch (action) {

            case "user":
                return res.user_info;
            case "server":
                return res.server_info;
            default:
                return res
        }

        return res;

    };


    /*
     *  Live Categories
     *  Returns an array of live categories
     *  { id: id, title: title, icon: url }
     */
    Xtream.prototype.getLiveCategories = function() {

        var cats = [];
        var res = _req.call(this,{ action: "get_live_categories" } );
        _debug.call(this, JSON.stringify(res), "Xtream:getLiveCategories")

        if(res) {
           for(var i in res) {
              cats.push({ id: res[i].category_id ?  res[i].category_id :  0,
                          title: res[i].category_name  ? res[i].category_name :  'Unknown',
                          icon: Plugin.path + 'images/livetv.png'
                        });
           }
        }

        return cats;

    };


    /*
     *  Live Streams
     *  Returns an array of live streams. Each element of the array is an object.
     *  { id: id, cat_id: category_id, title: name, icon: stream_icon, source:{ url: url } }
     */
    Xtream.prototype.getLiveStreams = function() {

        /*
          {"num":1464,
           "name":"XXX Vivid TV Europe",
           "stream_type":"live",
           "stream_id":88606,
           "stream_icon":"",
           "epg_channel_id":null,
           "added":"1574063931",
           "category_id":"18",
           "custom_sid":"",
           "tv_archive":0,
           "direct_source":"",
           "tv_archive_duration":0},
        */

        var live = [];

        var res = _req.call(this, { action: "get_live_streams" });
        _debug.call(this, JSON.stringify(res), "Xtream:getLiveStreams")

        if(res) {
           for(var i in res) {

              live.push({ id: res[i].stream_id ?  res[i].stream_id :  0,
                             cat_id: res[i].category_id ?  res[i].category_id :  0,
                             title: res[i].name ? res[i].name :  'Unknown',
                             icon: (res[i].stream_icon && res[i].stream_icon != '') ? res[i].stream_icon : Plugin.path + 'images/livetv.png',
                             source:{url:    this.baseUrl().playerApi + "/" + this.credentials().username + "/" + this.credentials().password + "/" + res[i].stream_id }
                           });
           }
        }

        return live;

    };


    /*
     *  Live Streams by category id
     *  Returns an array of vod streams.
     */
    Xtream.prototype.getLiveStreamsByCategoryId = function(id) {

        var streams = [];

        var res = (this).getLiveStreams();

        if(res) {

           for(var i in res) {

              if( res[i].cat_id == id ){

                  delete res[i].cat_id;
                  streams.push(res[i]);

              }
           }
        }

        return streams;

    }


    /*
     *  Vod Categories
     *  Returns an array of vod categories. Each element of the array is an object.
     *  [{ id: category_id, title: category_name, icon: icon }]
     */
    Xtream.prototype.getVodCategories = function() {

       /*
         [{\"category_id\":\"305\",\"category_name\":\"Vetrina SKY Primafila\",\"parent_id\":0}]
       */

        var cats = [];

        var res = _req.call(this, { action: "get_vod_categories" });
        _debug.call(this, JSON.stringify(res), "Xtream:getVodCategories")

        if(res) {
           for(var i in res) {
              cats.push({ id: res[i].category_id ?  res[i].category_id :  0,
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
     *  [{ id: id, cat_id: cat_id, title: title, icon: icon }]
     */
    Xtream.prototype.getVodStreams = function() {

        /*
          {\"num\":4336,\"name\":\"SIFFREDI LATE NIGHT 1x17 xxx\",\"stream_type\":\"movie\",\"stream_id\":89700,
           \"stream_icon\":null,\"rating\":null,\"rating_5based\":0,\"added\":\"1574581636\",\"category_id\":\"357\",
           \"container_extension\":\"mkv\",\"custom_sid\":\"\",\"direct_source\":\"\"},
        */

        var streams = [];

        var res = _req.call(this, { action: "get_vod_streams"});
        _debug.call(this, JSON.stringify(res), "Xtream:getVodStreams")

        if(res) {
           for(var i in res) {

              streams.push({ id: res[i].stream_id ?  res[i].stream_id :  0,
                             cat_id: res[i].category_id ?  res[i].category_id :  0,
                             title: res[i].name ? res[i].name :  'Unknown',
                             icon: (res[i].stream_icon && res[i].stream_icon != '') ? res[i].stream_icon : Plugin.path + 'images/vod.png'
                           });
           }
        }


        return streams;

    }


    /*
     *  Vod Streams by category id
     *  Returns an array of vod streams.
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

    }


    /*
     *  Vod Info
     *  Returns an array of vod stream.
     *  returns showtime video object
     */
    Xtream.prototype.getVodInfo = function(id) {

        var res = _req.call(this, { action: "get_vod_info", vod_id: id});
        _debug.call(this, JSON.stringify(res), "Xtream:getVodInfo")

         /*{"info":{
                    "movie_image":"http:\/\/pad.mymovies.it\/filmclub\/2002\/06\/029\/imm.jpg",
                    "genre":"Animazione",
                    "plot":"Sulla riva di un fiume tranquillo,",
                    "cast": "aumont, Ed Wynn, Richard Haydn",
                    "rating":"",
                    "director":"Clyde Geronimi, Wilfred Jackson",
                    "releasedate":"1951",
                    "duration_secs":4516,
                    "duration":"01:15:16",
                    "video":{
                             "index":0,
                             "codec_name":"h264",
                             "codec_long_name":"H.264 \/ AVC \/ MPEG-4 AVC \/ MPEG-4 part 10",
                             "profile":"Main",
                             "codec_type":"video",
                             "codec_time_base":"1\/60",
                             "codec_tag_string":"[0][0][0][0]",
                             "codec_tag":"0x0000",
                             "width":1280,
                             "height":720,
                             "coded_width":1280,
                             "coded_height":720,
                             "has_b_frames":1,"sample_aspect_ratio":"1:1",
                             "display_aspect_ratio":"16:9","pix_fmt":"yuv420p","level":41,"chroma_location":"left","field_order":"progressive","refs":1,"is_avc":"true","nal_length_size":"4",
                             "r_frame_rate":"30\/1",
                             "avg_frame_rate":"30\/1","time_base":"1\/1000","start_pts":0,"start_time":"0.000000","bits_per_raw_sample":"8",
                             "disposition":{
                                            "default":1,"dub":0,"original":0,"comment":0,"lyrics":0,"karaoke":0,"forced":0,"hearing_impaired":0,"visual_impaired":0,"clean_effects":0,"attached_pic":0,"timed_thumbnails":0
                                           }
                            },
                     "audio":"mp3","bitrate":2131,"imdb_id":"","backdrop_path":[],"youtube_trailer":"","tmdb_id":""
                    },

            "movie_data":{
                          "stream_id":1716,
                          "name":"Alice Nel Paese Delle Meraviglie",
                          "added":"1460485998",
                          "category_id":"22",
                          "container_extension":"mkv",
                          "custom_sid":"",
                          "direct_source":""
                         }
           }
        */

        var cn = res.info && res.info.video && res.info.video.codec_name ? res.info.video.codec_name : '';
        var cw = res.info && res.info.video && res.info.video.coded_width ? res.info.video.coded_width: '';
        var ch = res.info && res.info.video && res.info.video.coded_height ? res.info.video.coded_height: '';
        var au = res.info && res.info.audio ? res.info.audio.codec_name: '';
        var cast = res.info && res.info.cast ? res.info.cast: '';
        var dir = res.info && res.info.director ? res.info.director: '';
        var plot = res.info && res.info.plot ? res.info.plot: '';

        return  { id: res.movie_data.stream_id,
                  title: res.movie_data.name ? res.movie_data.name : 'unknown',
                  icon: res.info.movie_image ? res.info.movie_image: "skin://icons/ic_local_movie_48px.svg",
                  tagline: cn+" "+ cw+'x'+ch + ' - ' + au,
                  genre: res.info.genre ? res.info.genre : 'unknown',
                  description: cast + " - " + dir+"\n"+ plot ,
                  year: res.info.releaseDate ? res.info.releaseDate: '',
                  duration: res.info.duration ? res.info.duration: '',
                  source:{url:    this.baseUrl().playerApi + "/movie/" + this.credentials().username + "/" + this.credentials().password + "/" + id+ "." + res.movie_data.container_extension}
         };

    }


    Xtream.prototype.getSeries = function() {

        /* [{\"num\":498,
             \"name\":\"The Morning Show\",
             \"series_id\":505,
             \"cover\":\"https://m.media-amazon.com/images/M/MV5BMmYzY2U1NGYtZjE4Mi00MjA2LWE4NDktZjNhMzEzNDIzYjQyXkEyXkFqcGdeQXVyNjU2ODM5MjU@._V1_UX182_CR0,0,182,268_AL_.jpg\",
             \"plot\":\"Alex Levy conduce The Morning Show, un popolare programma di notizie\",
             \"cast\":\"Jennifer Aniston, Reese Witherspoon, Billy Crudup\",
             \"director\":\"Jay Carson, Kerry Ehrin\",
             \"genre\":\"Drammatico\",
             \"releaseDate\":\"2019\",
             \"last_modified\":\"1574584590\",
             \"rating\":\"0\",
             \"rating_5based\":0,
             \"backdrop_path\":[],
             \"youtube_trailer\":\"\",
             \"episode_run_time\":\"0\",
             \"category_id\":\"356\"
            }]
        */

        var series = [];

        var res = _req.call(this, { action: "get_series" } );
        _debug.call(this, JSON.stringify(res), "Xtream:getSeriesStreams request")

        if(res) {
           for(var i in res) {

              var cast = res[i].cast ? res[i].cast : '';
              var dir = res[i].director ? res[i].director: '';
              var plot = res[i].plot ? res[i].plot: '';

              series.push({ id: res[i].series_id ?  res[i].series_id :  0,
                            cat_id: res[i].category_id ?  res[i].category_id :  0,
                            title: res[i].name  ? res[i].name :  'Unknown',
                            icon: res[i].cover && res[i].cover != '' ? res[i].cover : "skin://icons/ic_movie_48px.svg",
                            tagline: res[i].episode_run_time ? res[i].episode_run_time : "?",
                            genre: res[i].genre ? res[i].genre : 'unknown',
                            description: cast + " - " + dir+ "\n" + plot ,
                            year: res[i].releaseDate ? res[i].releaseDate : '',
                            source:{url:    this.baseUrl().playerApi + "/series/" + this.credentials().username + "/" + this.credentials().password + "/" + res[i].series_id+ ".mp4"}
                        });
           }
        }

        _debug.call(this, JSON.stringify(series), "Xtream:getSeriesStreams stream return")

        return series;

    };


    /*
     *  Series Categories
     *  Returns an array of shows for the genre. Each element of the array is an object.
     *  { id: id, title: title, icon: icon }
     *
     */
    Xtream.prototype.getSeriesCategories = function() {
        /*[{\"category_id\":\"328\",\"category_name\":\"RAI Fiction\",\"parent_id\":0},{\"category_id\":\"320\",\"category_name\":\"Mediaset Fiction\",\"parent_id\":0},{\"category_id\":\"338\",\"category_name\":\"Mediaset Review\",\"parent_id\":0},{\"category_id\":\"316\",\"category_name\":\"Serie TV Netflix\",\"parent_id\":0},*/
        cats = [];

        var res = _req.call(this, { action: "get_series_categories" });
        _debug.call(this, JSON.stringify(res), "Xtream:getSeriesCategories")

        if(res) {
           for(var i in res) {
              cats.push({ id: res[i].category_id ?  res[i].category_id :  0,
                          title: res[i].category_name  ? res[i].category_name :  'Unknown',
                          icon: Plugin.path + 'images/series.png'
                        });
           }
        }

        return cats;


    };


    /*
     *  Vod Streams by category id
     *  Returns an array of vod streams.
     *  [{ id: id, title: title, icon: icon }]
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

    }


    /*
     *  Series Info
     *  Returns an array of series stream.
     *  returns showtime video object
     */
    Xtream.prototype.getSeriesInfo = function(id) {

         /*{"seasons":[],
            "info":{
                    "name":"Daredevil",
                    "cover":"https:\/\/m.media-amazon.com\/images\/M\/MV5BODcwOTg2MDE3NF5BMl5BanBnXkFtZTgwNTUyNTY1NjM@._V1_UX182_CR0,0,182,268_AL_.jpg",
                    "plot":"Hell's Kitchen. L'avvocato Matt Murdock, ",
                    "cast":"Charlie Cox, Vincent D'Onofrio, Deborah Ann Woll",
                    "director":"Drew Goddard",
                    "genre":"Supereroi",
                    "releaseDate":"2015",
                    "last_modified":"1553098834",
                    "rating":"0",
                    "rating_5based":0,
                    "backdrop_path":[],
                    "youtube_trailer":"HAYQG0mYGWs",
                    "episode_run_time":"0",
                    "category_id":"316"
                   },
             "episodes":{"1":[{"id":"58839",
                               "episode_num":1,
                               "title":"Daredevil 1x01",
                               "container_extension":"mp4",
                               "info":{
                                 "duration_secs":3041,
                                 "duration":"00:50:41",
                                 "video":{"index":0,"codec_name":"h264","codec_long_name":"H.264 \/ AVC \/ MPEG-4 AVC \/ MPEG-4 part 10",
                                   "profile":"High",
                                   "codec_type": "video",
                                   "codec_time_base": "1\/50",
                                   "codec_tag_string":"avc1",
                                   "codec_tag":"0x31637661",
                                   "width":720,"height":400,
                                   "coded_width":720,
                                   "coded_height":400,
                                   "has_b_frames":2,
                                   "sample_aspect_ratio":"80:81",
                                   "display_aspect_ratio":"16:9",
                                   "pix_fmt":"yuv420p",
                                   "level":31,
                                   "color_range":"tv",
                                   "color_space":"smpte170m",
                                   "color_transfer":"bt709","color_primaries":"bt470bg","chroma_location":"left","refs":1,"is_avc":"true",
                                   "nal_length_size":"4",
                                   "r_frame_rate":"25\/1","avg_frame_rate":"25\/1","time_base":"1\/90000","start_pts":0,"start_time":"0.000000","duration_ts":273690000,"duration":"3041.000000","bit_rate":"632680",
                                   "bits_per_raw_sample":"8","nb_frames":"76025",
                                   "disposition":{"default":1,"dub":0,"original":0,"comment":0,"lyrics":0,"karaoke":0,"forced":0,"hearing_impaired":0,"visual_impaired":0,"clean_effects":0,"attached_pic":0,"timed_thumbnails":0},
                                   "tags":{"creation_time":"2015-10-22T17:38:07.000000Z","language":"und","handler_name":"VideoHandler"}
                                 },
                                 "audio":{"index":1,"codec_name":"aac","codec_long_name":"AAC (Advanced Audio Coding)","profile":"LC","codec_type":"audio","codec_time_base":"1\/48000","codec_tag_string":"mp4a","codec_tag":"0x6134706d","sample_fmt":"fltp","sample_rate":"48000","channels":2,"channel_layout":"stereo","bits_per_sample":0,"r_frame_rate":"0\/0","avg_frame_rate":"0\/0","time_base":"1\/48000","start_pts":0,"start_time":"0.000000","duration_ts":145968128,"duration":"3041.002667","bit_rate":"160218","max_bit_rate":"200000","nb_frames":"142547",
                                          "disposition":{"default":1,"dub":0,"original":0,"comment":0,"lyrics":0,"karaoke":0,"forced":0,"hearing_impaired":0,"visual_impaired":0,"clean_effects":0,"attached_pic":0,"timed_thumbnails":0},
                                                "tags":{"creation_time":"2015-10-22T17:38:07.000000Z","language":"und","handler_name":"Stereo"}
                                 },
                                 "bitrate":799
                               },
                               "custom_sid":"",
                               "added":"1553098780",
                               "season":1,
                               "direct_source":""
                             },]
         */

        var series = [];

        var res = _req.call(this, { action: "get_series_info", series_id: id});
        _debug.call(this, JSON.stringify(res), "Xtream:getSeriesInfo")

        if(res.episodes){
            for (var i in res.episodes) {
                for(var j in res.episodes[i] ){

                    var cn = res.episodes[i][j].info && res.episodes[i][j].info.video && res.episodes[i][j].info.video.codec_name ? res.episodes[i][j].info.video.codec_name : '';
                    var cw = res.episodes[i][j].info && res.episodes[i][j].info.video && res.episodes[i][j].info.video.coded_width ? res.episodes[i][j].info.video.coded_width: '';
                    var ch = res.episodes[i][j].info && res.episodes[i][j].info.video && res.episodes[i][j].info.video.coded_height ? res.episodes[i][j].info.video.coded_height: '';
                    var au = res.episodes[i][j].info && res.episodes[i][j].info.audio ? res.episodes[i][j].info.audio.codec_name: '';
                    var cast = res.info && res.info.cast ? res.info.cast: '';
                    var dir = res.info && res.info.director ? res.info.director: '';
                    //var plot = res.info && res.info.plot ? res.info.plot: '';

                    series.push({ id: res.episodes[i][j].id,
                                  title: res.episodes[i][j].title ? res.episodes[i][j].title : 'unknown',
                                  icon: res.info.cover ? res.info.cover: "skin://icons/ic_local_movie_48px.svg",
                                  tagline: cn+" "+ cw+'x'+ch + ' - ' + au,
                                  genre: res.info.genre ? res.info.genre : 'unknown',
                                  //description: cast + " - " + dir+"\n"+ plot ,
                                  year: res.info.releaseDate ? res.info.releaseDate: '',
                                  vtype: 'tvseries' ,
                                  season: {number: res.episodes[i][j].season},
                                  episode: {title:res.episodes[i][j].title ? res.episodes[i][j].title : 'unknown' ,number:res.episodes[i][j].episode_num},
                                  duration:res.episodes[i][j].info && res.episodes[i][j].info.duration ? res.episodes[i][j].info.duration: '',
                                  source:{url:    this.baseUrl().playerApi + "/series/" + this.credentials().username + "/" + this.credentials().password + "/" + res.episodes[i][j].id+ "." + res.episodes[i][j].container_extension}
                                 });
                }
            }
        }

         return series;

    };


    Xtream.prototype.getEpg = function() {
        /*
          <tv  ......
            <channel id="">
              <display-name>TeenNick</display-name>
              <icon src="http://webtv.aystream.com/webtv/loghi/teennick.png" />
           </channel>
           <programme start="20191205115800 +0100" stop="20191205133600 +0100" channel="Premium Cinema HD" >
             <title>Il Viaggio Di Fanny</title>
             <desc>Regia di L. Doillon; FRA 2016 - Commovente film vincitore del Giffoni 2016, basato sulla vera storia di Fanny Ben-Ami, una ragazzina ebrea che nel 1943, durante l&apos;occupazione tedesca in Francia, viene mandata insieme alle due sorelle in una colonia in montagna. Un viaggio emozionante sull&apos;amicizia e la liberta&apos; raccontato attraverso gli occhi dei bambini(n)</desc>
           </programme>
        */

        var res = _reqEpg.call(this);
        _debug.call(this, JSON.stringify(res), "Xtream:getEpg")
//        _debug.call(this, res.tv.channel[1], "Xtream:getEpg")
//        return res;

    };




    /*
     *  Seasons
     *  Returns an array of seasons for the show. Each element of the array is an object.
     *  { title: title, episodes: { title: title, path: path } }
     */
/*    Xtream.prototype.getEpg = function() {

        var res = _reqEpg.call(this);
        _debug.call(this, JSON.stringify(res), "Xtream:getEpg")
        return res;

    };
*/
    Xtream.prototype.getAnnouncement = function() {

/*
POST /response_api.php HTTP/1.1
User-Agent: IPTV Smarters Pro
Content-Type: application/x-www-form-urlencoded
Content-Length: 116
Host: api-android.whmcssmarters.com
Connection: close
Accept-Encoding: gzip, deflate
action=getAnnouncement&sc=3bcc1524a81f1796ac58cc1091683606&apikey=K60b0ad74709c08209e4b5e0efcb7a814&rand_num=5869015
*/


        var res = false;


        return res;

    };




    return Xtream;

})();


module.exports = Xtream;
