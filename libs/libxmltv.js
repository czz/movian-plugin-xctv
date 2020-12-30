/**
 *  libxmltv is a module for ecmascript
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



var XmlTv = (function () {


    var _OPTIONS = {
                     debug : false,
                     protocol: "http",
                     // port: 80
                   };


    /* construct */
    function XmlTv(options) {

        if (options === Object(options) && Object.prototype.toString.call(options) !== '[object Array]') {
            this.options = function () {
                return  {
                          debug : options.debug ? options.debug : _OPTIONS.debug,
                          protocol : options.protocol ? options.protocol : _OPTIONS.protocol,
                        };
            }
        }

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
     * Private method _getAttributes
     */
    function _getAttributes(string) {

        var matches = string.match(/\s*([^=]+)=\s*([^\s]+)/ig);
        if(matches === null) return false;

        var res = {};

        for ( var i in matches) {

            var attr = matches[i].match(/([^=]+)=/);
            var value = matches[i].match(/=(.*)/);

            if(attr !== null && value !== null){
                res[attr[1]] = value[1];
            }

        }

        _debug.call(this, JSON.stringify(res), "XmlTv:_getAttributes")

        return res;

    }


    /*
     * Private method _getTags
     */
    function _getTags(string) {

//        if(string == 'undefined') return false;

        var matches = string.match(/<([^>]+)>(.*?)<\/([^>]+)>/ig);
//console.log(JSON.stringify(matches)+"MATCHTAGS");
        if(matches === null) return false;

        var res = [];
        for (var i in matches){

//if(matches[i] != 'undefined'){
             var tag = matches[i].match(/<([^>]+)>(.*?)<\/([^>]+)>/i);
//console.log(JSON.stringify(tag)+"MATCHTAG");

             res.push( { name : tag[1] ? tag[1] : 'unknown', content: tag[2] ? tag[2] : '' });
//}

        }
        _debug.call(this, JSON.stringify(res), "XmlTv:_getTags");

        return res;

    }


    /*
     *  Get Doctype
     *  returns string
     *
     */
    XmlTv.prototype.getDoctype = function (string) {

        var res = string.match(/<\!DOCTYPE([^>]+)>/i);

        _debug.call(this, JSON.stringify(res), "XmlTv:getDoctype")

        if( res !== null ) { 
           return res[1];
        }

        return false;

    };


    /*
     *  Get Xml
     *  returns object
     *
     */
    XmlTv.prototype.getXml = function (string) {

        var match = string.match(/<\?xml(.*)\?>/i);
        if( match === null ) { return false; }

        var res = { attr: _getAttributes.call(this, match[1]) };

        _debug.call(this, JSON.stringify(res), "XmlTv:getDoctype")

        return res;

    };


    /*
     *  Get Tv
     *  returns object
     *
     */
    XmlTv.prototype.getTv = function (string) {

        var match = string.match(/<\s*tv([^>]*)>(.*?)<\s*\/\s*tv>/i);
        if( match === null ) { return false; }

        var res = { attr : _getAttributes.call(this, match[1]), content: match[2] ? match[2] : '' };

        _debug.call(this, JSON.stringify(res), "XmlTv:getTv");

        return res;

    };

    /*
     *  Get Tv
     *  returns object
     *
     */
    XmlTv.prototype.getChannels = function (string) {

        var match = string.match(/<\s*channel[^>]*>(.*?)<\s*\/\s*channel>/ig);
        if( match === null ) { return false; }

        var res = [];
        for (var i in match){
             var channel = match[i].match(/<\s*channel([^>]*)>(.*?)<\s*\/\s*channel>/i);
             console.log(channel[2]+"CHANNEL");

var tags = _getTags.call(this, channel[2]);
console.log("QUI"+JSON.stringify(tags));

             var subtags = {};

/*             while (true) {
                if(tags.content == 'undefined') break;
                tags = _getTags.call(this, tags.content);
               console.log(JSON.stringify(tags));
             }

*/

             res.push = { attr : _getAttributes.call(this, channel[1]), content: channel[2] ? channel[2] : '' , list : {} };
//             res.push = { attr : _getAttributes.call(this, channel[1]), content: subtags ? subtags : {} };


        }


        


        _debug.call(this, JSON.stringify(res), "XmlTv:getChannels");

        return res;

    };






    return XmlTv;

})();


module.exports = XmlTv;
