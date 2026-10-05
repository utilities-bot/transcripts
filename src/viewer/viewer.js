/* The transcript viewer.

   One plain script with no dependencies. It is written inline into every
   transcript file, and a website can load the same file to show a transcript
   in a page of its own, so the two can never look different.

   It takes the transcript's data and draws it the way Discord draws a channel:
   grouped messages, replies, forwarded messages, attachments, embeds, buttons,
   menus, containers, reactions, stickers and polls, with Discord's markdown.

   Everything that came from a message goes into the page through esc(), and
   every address is checked before it becomes a link or a picture. Nothing in a
   transcript can run script here.

   render() builds a string and touches no DOM, which is what lets it be tested
   outside a browser. mount() puts that string on the page and wires the few
   things that respond to a click. */
(function (root) {
"use strict";

var TWEMOJI = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/";
var EMOJI_RE = /(?:\p{RI}\p{RI}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{EMod})?(?:‍\p{Extended_Pictographic}(?:️|\p{EMod})?)*)/u;
var ONLY_EMOJI = /^\s*(?:(?:<a?:\w+:\d+>|\p{Extended_Pictographic}|\p{RI}|️|‍|\p{EMod})\s*){1,30}$/u;

/* ---------- small things */
function esc(s){ return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function isHttp(v){ return typeof v === "string" && /^https?:\/\/[^\s]+$/i.test(v); }
function isPicture(v){ return typeof v === "string" && /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+\/=]+$/.test(v); }
/* Kept in step with src/urls.js: the collector asks for an emoji by this address and this looks it up again. */
function emojiUrl(id, animated){ return "https://cdn.discordapp.com/emojis/" + id + "." + (animated ? "gif" : "webp") + "?size=48"; }
function bytesText(n){
  if (!n) return "";
  if (n < 1024) return n + " bytes";
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 2 : 1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}
function plural(n, word){ return n + " " + word + (n === 1 ? "" : "s"); }

var ICON = {
  hash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.99 3.16A1 1 0 1 0 9 2.84L8.15 8H4a1 1 0 0 0 0 2h3.82l-.67 4H3a1 1 0 1 0 0 2h3.82l-.8 4.84a1 1 0 0 0 1.97.32L8.85 16h4.97l-.8 4.84a1 1 0 0 0 1.97.32l.86-5.16H20a1 1 0 1 0 0-2h-3.82l.67-4H21a1 1 0 1 0 0-2h-3.82l.8-4.84a1 1 0 1 0-1.97-.32L15.15 8h-4.97l.8-4.84ZM14.15 14l.67-4H9.85l-.67 4h4.97Z" fill-rule="evenodd" clip-rule="evenodd"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 2a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8l-6-6H6Zm7 1.5L18.5 9H14a1 1 0 0 1-1-1V3.5ZM8 13h8v1.5H8V13Zm0 3.5h8V18H8v-1.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7Zm7 0a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3Z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11-6.86a1 1 0 0 0 0-1.7l-11-6.87A1 1 0 0 0 8 5.14Z"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15 2a1 1 0 0 0 0 2h3.59l-7.3 7.3a1 1 0 0 0 1.42 1.4L20 5.42V9a1 1 0 1 0 2 0V3a1 1 0 0 0-1-1h-6Z"/><path fill="currentColor" d="M5 5a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2v-6a1 1 0 1 0-2 0v6H5V7h6a1 1 0 1 0 0-2H5Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5.3 9.3a1 1 0 0 1 1.4 0l5.3 5.29 5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.42Z"/></svg>',
  join: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4-1.4l4.29-4.3H4a1 1 0 1 1 0-2h13.59l-4.3-4.3a1 1 0 0 1 0-1.4Z"/></svg>',
  leave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.7 5.3a1 1 0 0 0-1.4 0l-6 6a1 1 0 0 0 0 1.4l6 6a1 1 0 0 0 1.4-1.4L6.42 13H20a1 1 0 1 0 0-2H6.41l4.3-4.3a1 1 0 0 0 0-1.4Z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.38 11.38a3 3 0 0 0 4.24 0l.03-.03a.5.5 0 0 0 0-.7L13.35.35a.5.5 0 0 0-.7 0l-.03.03a3 3 0 0 0 0 4.24L13 5l-2.92 2.92-3.65-.34a2 2 0 0 0-1.6.58l-.62.63a1 1 0 0 0 0 1.42l9.58 9.58a1 1 0 0 0 1.42 0l.63-.63a2 2 0 0 0 .58-1.6l-.34-3.64L19 11l.38.38ZM9.07 17.07a.5.5 0 0 1-.08.77l-5.15 3.43a.5.5 0 0 1-.63-.06l-.42-.42a.5.5 0 0 1-.06-.63L6.16 15a.5.5 0 0 1 .77-.08l2.14 2.14Z"/></svg>',
  boost: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.6 5.2 8.4v7.2l6.8 6.8 6.8-6.8V8.4L12 1.6Zm3.8 12.76L12 18.16l-3.8-3.8V9.64L12 5.84l3.8 3.8v4.72Z"/><path fill="currentColor" d="m9.6 10.2 2.4-2.4 2.4 2.4v3.6L12 16.2l-2.4-2.4v-3.6Z"/></svg>',
  thread: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.81a1 1 0 0 1 0-1.41l.36-.36a1 1 0 0 1 1.41 0l9.2 9.2a1 1 0 0 1 0 1.4l-.7.7a1 1 0 0 1-1.3.13l-9.54-6.72a1 1 0 0 1-.08-1.58l1-1L12 2.8ZM12 21.2a1 1 0 0 1 0 1.41l-.35.35a1 1 0 0 1-1.41 0l-9.2-9.19a1 1 0 0 1 0-1.41l.7-.7a1 1 0 0 1 1.3-.12l9.54 6.72a1 1 0 0 1 .07 1.58l-1 1 .35.36ZM15.66 16.8a1 1 0 0 1-1.38.28l-8.49-5.66A1 1 0 1 1 6.9 9.76l8.49 5.65a1 1 0 0 1 .27 1.39ZM17.1 14.25a1 1 0 1 0 1.11-1.66L9.73 6.93a1 1 0 0 0-1.11 1.66l8.49 5.66Z"/></svg>',
  forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.7 7.3a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L18.58 9H13a7 7 0 0 0-7 7v4a1 1 0 1 1-2 0v-4a9 9 0 0 1 9-9h5.59l-3.3-3.3a1 1 0 0 1 1.42-1.4l5 5Z"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm13.35 8.13 3.5 4.67c.37.5.02 1.2-.6 1.2H5.81a.75.75 0 0 1-.59-1.22l1.86-2.32a1.5 1.5 0 0 1 2.34 0l.5.64 2.23-2.97a2 2 0 0 1 3.2 0ZM10.2 5.98c.23-.91-.88-1.55-1.55-.9a.93.93 0 0 1-1.3 0c-.67-.65-1.78-.01-1.55.9a.93.93 0 0 1-.65 1.12c-.9.26-.9 1.54 0 1.8.48.14.77.63.65 1.12-.23.91.88 1.55 1.55.9a.93.93 0 0 1 1.3 0c.67.65 1.78.01 1.55-.9a.93.93 0 0 1 .65-1.12c.9-.26.9-1.54 0-1.8a.93.93 0 0 1-.65-1.12Z" fill-rule="evenodd" clip-rule="evenodd"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5 3.5 4.6v6.5c0 5.2 3.5 9.9 8.5 11.4 5-1.5 8.5-6.2 8.5-11.4V4.6L12 1.5Zm-1.2 14.3-3.6-3.6 1.4-1.4 2.2 2.2 4.8-4.8 1.4 1.4-6.2 6.2Z"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V9h2v4Z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0Z" fill-rule="evenodd" clip-rule="evenodd"/></svg>',
  slash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 3a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Zm9.6 3.3a1 1 0 0 1 .6 1.3l-4.5 10.5a1 1 0 1 1-1.84-.8L13.3 6.9a1 1 0 0 1 1.3-.6Z"/></svg>'
};

/* ---------- pictures: the copy saved in the file first, the live address otherwise */
function src(c, url){
  if (typeof url !== "string" || !url) return null;
  var saved = c.assets[url];
  if (isPicture(saved)) return saved;
  return isHttp(url) ? url : null;
}
/* A file saved in the transcript. Only ever plain bytes handed to a download link, never a page:
   the exporter stores every file as application/octet-stream, and anything else is refused here. */
function savedFile(c, url){
  var v = typeof url === "string" ? c.assets[url] : null;
  return typeof v === "string" && /^data:application\/octet-stream;base64,[A-Za-z0-9+\/=]*$/.test(v) ? v : null;
}

/* ---------- emoji */
function twemojiUrl(e){
  var cps = [], zwj = e.indexOf("‍") >= 0;
  for (var ch of e) { var cp = ch.codePointAt(0); if (cp === 0xFE0F && !zwj) continue; cps.push(cp.toString(16)); }
  return TWEMOJI + cps.join("-") + ".svg";
}
function emojiText(t, big){
  var out = "", rest = String(t), m;
  while ((m = rest.match(EMOJI_RE))) {
    out += esc(rest.slice(0, m.index));
    out += '<img class="emoji' + (big ? " emoji--big" : "") + '" src="' + twemojiUrl(m[0]) + '" alt="' + esc(m[0]) + '" draggable="false" loading="lazy" data-e="emoji">';
    rest = rest.slice(m.index + m[0].length);
  }
  return out + esc(rest);
}
function customEmoji(c, id, name, animated, big){
  var s = src(c, emojiUrl(id, animated));
  if (!s) return esc(":" + name + ":");
  return '<img class="emoji' + (big ? " emoji--big" : "") + '" src="' + esc(s) + '" alt=":' + esc(name) + ':" title=":' + esc(name) + ':" draggable="false" loading="lazy" data-e="emoji">';
}
function emojiOf(c, e){
  if (!e) return "";
  if (e.id) return customEmoji(c, e.id, e.name || "emoji", e.animated);
  return emojiText(e.name || "");
}

/* ---------- names */
function userOf(c, key){ return c.users[key] || { name: "Unknown User" }; }
function shown(u){ return u.display || u.name || "Unknown User"; }
function nameHtml(c, key, extra){
  var u = userOf(c, key);
  return '<span class="name' + (extra ? " " + extra : "") + '"' + (u.color ? ' style="color:' + esc(u.color) + '"' : "") + ' data-user="' + esc(key) + '">' + esc(shown(u)) + "</span>";
}
function tagHtml(u){
  if (u.webhook || u.bot) return '<span class="tag">' + (u.verified ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m6.2 11.6-3-3 1.1-1.1 1.9 1.9 5.5-5.5 1.1 1.1-6.6 6.6Z"/></svg>' : "") + "APP</span>";
  return "";
}
function avatarHtml(c, key, cls){
  var u = userOf(c, key), s = src(c, u.avatar);
  if (s) return '<img class="' + cls + '" src="' + esc(s) + '" alt="" draggable="false" loading="lazy" data-user="' + esc(key) + '" data-e="avatar" data-n="' + esc(shown(u).slice(0, 1)) + '">';
  return '<span class="' + cls + ' av--blank" data-user="' + esc(key) + '" aria-hidden="true">' + esc(shown(u).slice(0, 1).toUpperCase()) + "</span>";
}

/* ---------- time: written in the reader's own language and order, as Discord does */
function fmt(o){ try { return new Intl.DateTimeFormat(undefined, o); } catch (e) { return new Intl.DateTimeFormat("en-US", o); } }
var F_TIME = fmt({ hour: "numeric", minute: "2-digit" }), F_SECS = fmt({ hour: "numeric", minute: "2-digit", second: "2-digit" });
var F_SHORT = fmt({ day: "2-digit", month: "2-digit", year: "numeric" }), F_LONG = fmt({ day: "numeric", month: "long", year: "numeric" });
var F_FULL = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
var F_BOTH = fmt({ day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
var F_DAY = fmt({ day: "numeric", month: "short", year: "numeric" });
function clock(d){ return F_TIME.format(d); }
function sameDay(a, b){ return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function longDate(d){ return F_LONG.format(d); }
function fullDate(d){ return F_FULL.format(d); }
function stamp(ms){ var d = new Date(ms); return F_SHORT.format(d) + " " + F_TIME.format(d); }
function timeHtml(ms, cls, label){
  var d = new Date(ms);
  return '<time class="' + cls + '" datetime="' + d.toISOString() + '" title="' + esc(fullDate(d)) + '">' + esc(label == null ? stamp(ms) : label) + "</time>";
}
/* "an hour ago", "3 days ago", "in a minute": Discord's wording for a relative time */
function relative(s){
  var a = Math.abs(s), n = function(x, unit){ return Math.round(a / x) + " " + unit; };
  var t = a < 45 ? "a few seconds" : a < 90 ? "a minute" : a < 2700 ? n(60, "minutes") : a < 5400 ? "an hour" : a < 79200 ? n(3600, "hours") :
    a < 129600 ? "a day" : a < 2246400 ? n(86400, "days") : a < 3888000 ? "a month" : a < 29808000 ? n(2592000, "months") : a < 47304000 ? "a year" : n(31536000, "years");
  return s < 0 ? t + " ago" : "in " + t;
}
/* how long something lasted, in the two largest units that matter: "2h 14m", "3d 4h", "45s" */
function lasted(ms){
  var s = Math.max(0, Math.round(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d) return d + "d" + (h ? " " + h + "h" : "");
  if (h) return h + "h" + (m ? " " + m + "m" : "");
  if (m) return m + "m";
  return s + "s";
}
function utcText(ms){ return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC"; }
function fmtTime(sec, style, now){
  var d = new Date(sec * 1000);
  switch (style) {
    case "t": return F_TIME.format(d);
    case "T": return F_SECS.format(d);
    case "d": return F_SHORT.format(d);
    case "D": return F_LONG.format(d);
    case "F": return F_FULL.format(d);
    case "R": return relative(Math.round((d - now) / 1000));
    default: return F_BOTH.format(d);
  }
}
/* when an account was made is written into its id: the top bits are milliseconds since 2015 */
function createdAt(id){
  try { var ms = Number((BigInt(id) >> 22n) + 1420070400000n); return ms > 1420070400000 && ms < 4102444800000 ? ms : null; } catch (e) { return null; }
}

/* ---------- Discord markdown
   Blocks: ``` code blocks, > and >>> quotes, # ## ### headings, -# subtext, and
   - * 1. lists nested by indentation. Inline: ** __ * _ ~~ || and `code` in any
   combination, [masked](links), bare and <angle> links, mentions, <t:…>
   timestamps, custom and unicode emoji, and \ escapes. The same rules the
   Utilities website uses for its embed preview. */
function mention(text, style){ return '<span class="mention"' + (style || "") + ">" + esc(text) + "</span>"; }
var INLINE = [
  [/^\\([^0-9A-Za-z\s])/, function(m){ return esc(m[1]); }],
  [/^(`+)([\s\S]*?[^`])\1(?!`)/, function(m){ return "<code>" + esc(m[2].trim()) + "</code>"; }],
  [/^<(a?):(\w{2,32}):(\d{15,21})>/, function(m, c, o){ return customEmoji(c, m[3], m[2], !!m[1], o.big); }],
  [/^<t:(-?\d{1,13})(?::([tTdDfFR]))?>/, function(m, c){ return '<span class="stamp" title="' + esc(fullDate(new Date(+m[1] * 1000))) + '">' + esc(fmtTime(+m[1], m[2] || "f", c.now)) + "</span>"; }],
  [/^<@!?(\d{15,21})>/, function(m, c){ var u = c.users[m[1]]; return mention("@" + (u ? shown(u) : "unknown-user"), u ? ' data-user="' + esc(m[1]) + '"' : ""); }],
  [/^<@&(\d{15,21})>/, function(m, c){
    var r = c.roles[m[1]];
    if (!r) return mention("@deleted-role");
    return mention("@" + r.name, r.color ? ' style="color:' + esc(r.color) + ";background:" + esc(r.color) + '1f"' : "");
  }],
  [/^<#(\d{15,21})>/, function(m, c){ var ch = c.channels[m[1]]; return mention("#" + (ch ? ch.name : "unknown")); }],
  [/^<\/([\w-]+(?: [\w-]+){0,2}):(\d{15,21})>/, function(m){ return mention("/" + m[1]); }],
  [/^@(everyone|here)\b/, function(m){ return mention("@" + m[1]); }],
  [/^\[((?:\\.|[^\[\]\\])+)\]\(<?(https?:\/\/[^\s)>]+)>?(?: +"[^"]*")?\)/, function(m, c, o){ return '<a href="' + esc(m[2]) + '" target="_blank" rel="noopener noreferrer">' + inline(c, m[1], o) + "</a>"; }],
  [/^<(https?:\/\/[^\s>]+)>/, function(m){ return '<a href="' + esc(m[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[1]) + "</a>"; }],
  [/^https?:\/\/[^\s<]+[^<.,:;"')\]\s]/, function(m){ return '<a href="' + esc(m[0]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[0]) + "</a>"; }],
  [/^\*\*\*([\s\S]+?)\*\*\*(?!\*)/, function(m, c, o){ return "<b><i>" + inline(c, m[1], o) + "</i></b>"; }],
  [/^\*\*([\s\S]+?)\*\*(?!\*)/, function(m, c, o){ return "<b>" + inline(c, m[1], o) + "</b>"; }],
  [/^__([\s\S]+?)__(?!_)/, function(m, c, o){ return "<u>" + inline(c, m[1], o) + "</u>"; }],
  [/^\*(?=\S)((?:\*\*|\\[\s\S]|\s+(?:\\[\s\S]|[^\s*\\]|\*\*)|[^\s*\\])+?)\*(?!\*)/, function(m, c, o){ return "<i>" + inline(c, m[1], o) + "</i>"; }],
  [/^_((?:__|\\[\s\S]|[^\\_])+?)_(?![A-Za-z0-9])/, function(m, c, o, prev){ return /[A-Za-z0-9]$/.test(prev) ? null : "<i>" + inline(c, m[1], o) + "</i>"; }],
  [/^~~([\s\S]+?)~~/, function(m, c, o){ return "<s>" + inline(c, m[1], o) + "</s>"; }],
  [/^\|\|([\s\S]+?)\|\|/, function(m, c, o){ return '<span class="spoiler" role="button" tabindex="0" aria-label="Spoiler"><span>' + inline(c, m[1], o) + "</span></span>"; }]
];
function inline(c, text, o){
  o = o || {};
  var s = String(text), out = "", i = 0, buf = "", prev = "";
  var flush = function(){ if (buf) { out += emojiText(buf, o.big); buf = ""; } };
  while (i < s.length) {
    var rest = s.slice(i), hit = false;
    if ("\\`<@[h*_~|".indexOf(rest[0]) >= 0) {
      for (var k = 0; k < INLINE.length; k++) {
        var m = rest.match(INLINE[k][0]);
        if (!m) continue;
        var html = INLINE[k][1](m, c, o, prev + buf);
        if (html === null) continue;
        flush(); out += html; i += m[0].length; prev = m[0]; hit = true; break;
      }
    }
    if (!hit) { buf += s[i]; i++; }
  }
  flush();
  return out;
}
function blocks(c, lines, o){
  var out = "", i = 0;
  while (i < lines.length) {
    var line = lines[i], m;
    if (/^```/.test(line)) {
      var body = [], first = line.slice(3), one = first.indexOf("```");
      if (one >= 0) { out += "<pre>" + esc(first.slice(0, one)) + "</pre>"; i++; continue; }
      if (first && !/^[a-z0-9_+\-.#]*$/i.test(first)) body.push(first);
      i++;
      while (i < lines.length && lines[i].indexOf("```") < 0) { body.push(lines[i]); i++; }
      if (i < lines.length) { var end = lines[i].indexOf("```"); if (end > 0) body.push(lines[i].slice(0, end)); i++; }
      out += "<pre>" + esc(body.join("\n")) + "</pre>";
      continue;
    }
    if (!o.inQuote && /^>>> /.test(line)) {
      out += "<blockquote>" + blocks(c, [line.slice(4)].concat(lines.slice(i + 1)), { inQuote: true }) + "</blockquote>"; break;
    }
    if (!o.inQuote && /^> /.test(line)) {
      var q = [];
      while (i < lines.length && /^> /.test(lines[i])) { q.push(lines[i].slice(2)); i++; }
      out += "<blockquote>" + blocks(c, q, { inQuote: true }) + "</blockquote>";
      continue;
    }
    if (!o.inSub && (m = line.match(/^(#{1,3}) +(\S.*)$/))) { out += '<p class="md-h md-h' + m[1].length + '">' + inline(c, m[2]) + "</p>"; i++; continue; }
    if (!o.inSub && (m = line.match(/^-# +(\S.*)$/))) { out += '<div class="md-sub">' + blocks(c, [m[1]], { inQuote: true, inSub: true }) + "</div>"; i++; continue; }
    if (/^ *(?:[-*]|\d{1,9}\.) +\S/.test(line)) {
      var items = [];
      while (i < lines.length && (m = lines[i].match(/^( *)([-*]|\d{1,9}\.) +(\S.*)$/))) { items.push({ d: Math.floor(m[1].length / 2), ord: /\d/.test(m[2]), n: parseInt(m[2], 10), t: m[3] }); i++; }
      for (var at = 0; at < items.length;) { var made = list(c, items, at, items[at].d); out += made.html; at = made.next; }
      continue;
    }
    var para = [];
    while (i < lines.length && !/^(```|> |#{1,3} +\S|-# +\S| *(?:[-*]|\d{1,9}\.) +\S)/.test(lines[i]) && !(!o.inQuote && /^>>> /.test(lines[i]))) { para.push(lines[i]); i++; }
    if (para.length) out += "<p>" + para.map(function(l){ return inline(c, l, o); }).join("<br>") + "</p>";
    else { out += "<p>" + inline(c, line, o) + "</p>"; i++; }
  }
  return out;
}
function list(c, items, at, depth){
  var ord = items[at] && items[at].ord, html = ord ? '<ol start="' + items[at].n + '">' : "<ul>", i = at;
  while (i < items.length && items[i].d >= depth) {
    if (items[i].d === depth && items[i].ord !== ord) break;
    if (items[i].d > depth) { var inner = list(c, items, i, items[i].d); html = html.replace(/<\/li>$/, inner.html + "</li>"); i = inner.next; continue; }
    var t = items[i].t, sub = t.match(/^-# +(\S.*)$/);
    html += "<li>" + (sub ? '<span class="md-sub">' + inline(c, sub[1]) + "</span>" : inline(c, t)) + "</li>"; i++;
  }
  return { html: html + (ord ? "</ol>" : "</ul>"), next: i };
}
function md(c, text, opt){
  var t = String(text || "");
  return blocks(c, t.split("\n"), { big: !!(opt && opt.jumbo) && ONLY_EMOJI.test(t) });
}

/* ---------- pictures and files */
function fit(w, h, maxW, maxH){
  if (!w || !h) return null;
  var k = Math.min(1, maxW / w, maxH / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
function missing(label){ return '<span class="lost">' + ICON.image + "<span>" + esc(label || "Image") + " is no longer available</span></span>"; }
function tile(c, m, o){
  o = o || {};
  var s = src(c, m && m.url), cls = "pic" + (o.spoiler ? " is-spoiler" : "") + (o.cls ? " " + o.cls : "");
  if (!s) return '<span class="' + cls + ' is-lost">' + missing(o.name) + "</span>";
  var box = o.fill ? null : fit(m.w, m.h, o.maxW || 400, o.maxH || 300);
  if (o.link) return '<a class="' + cls + '" href="' + esc(o.link) + '" target="_blank" rel="noopener noreferrer"' + (box ? ' style="width:' + box.w + "px;aspect-ratio:" + box.w + "/" + box.h + '"' : "") + ">" +
    '<img src="' + esc(s) + '" alt="' + esc(o.alt || o.name || "") + '" loading="lazy" draggable="false" data-e="pic" data-n="' + esc(o.name || "Image") + '">' +
    (o.badge ? '<span class="pic__badge">' + esc(o.badge) + "</span>" : "") + "</a>";
  return '<span class="' + cls + '" data-zoom role="button" tabindex="0"' + (box ? ' style="width:' + box.w + "px;aspect-ratio:" + box.w + "/" + box.h + '"' : "") + ">" +
    '<img src="' + esc(s) + '" alt="' + esc(o.alt || o.name || "") + '" loading="lazy" draggable="false" data-e="pic" data-n="' + esc(o.name || "Image") + '">' +
    (o.badge ? '<span class="pic__badge">' + esc(o.badge) + "</span>" : "") +
    (o.spoiler ? '<span class="pic__veil">SPOILER</span>' : "") + "</span>";
}
function gallery(c, items){
  if (!items.length) return "";
  if (items.length === 1) return '<div class="media">' + tile(c, items[0].media, items[0]) + "</div>";
  return '<div class="media media--grid media--' + Math.min(items.length, 4) + '">' + items.map(function(it){
    return tile(c, it.media, Object.assign({}, it, { fill: true }));
  }).join("") + "</div>";
}
/* ---------- voice messages, sound and video
   A saved file is kept as plain bytes, so nothing here is a player until somebody presses play:
   only then are the bytes given their real type and handed to the browser (see playable()). */
function clock(s){ s = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
/* a voice message's waveform as bars: Discord sends up to 256 loudness samples, drawn as 40 */
function waveBars(wave){
  var raw = "", out = "";
  try { raw = atob(wave || ""); } catch (e) {}
  var n = Math.min(40, raw.length);
  for (var i = 0; i < n; i++) {
    var from = Math.floor(i * raw.length / n), to = Math.max(from + 1, Math.floor((i + 1) * raw.length / n)), peak = 0;
    for (var j = from; j < to; j++) peak = Math.max(peak, raw.charCodeAt(j));
    out += '<i style="height:' + Math.max(12, Math.round(peak / 255 * 100)) + '%"></i>';
  }
  return out;
}
function mediaMime(a){ return /^(audio|video)\/[a-z0-9.+-]{1,40}$/.test(a.mime || "") ? a.mime : a.kind === "video" ? "video/mp4" : "audio/ogg"; }
function voiceCard(c, a){
  var saved = !!savedFile(c, a.url);
  return '<div class="voice' + (saved ? "" : " is-off") + '"' + (saved ? ' data-play="' + esc(a.url) + '" data-mime="' + mediaMime(a) + '"' : "") + ' data-secs="' + (Number(a.secs) || 0) + '">' +
    '<button type="button" class="voice__btn"' + (saved ? ' aria-label="Play voice message"' : ' disabled aria-label="Voice message, not saved" title="Not saved in this transcript"') + ">" + ICON.play + ICON.pause + "</button>" +
    '<span class="voice__wave" aria-hidden="true">' + waveBars(a.wave) + '</span><span class="voice__time">' + clock(a.secs) + "</span></div>" +
    (saved ? "" : '<div class="voice__note">Voice message \u00b7 Not saved, the link may have expired</div>');
}
function fileCard(c, a){
  if (a.kind === "audio" && a.wave) return voiceCard(c, a);
  var name = esc(a.name || "file"), size = bytesText(a.size), data = savedFile(c, a.url);
  var plays = data && (a.kind === "video" || a.kind === "audio");
  var title = data ? '<a class="file__name" href="' + data + '" download="' + name + '">' + name + "</a>"
    : isHttp(a.url) ? '<a class="file__name" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' + name + "</a>"
    : '<span class="file__name">' + name + "</span>";
  var note = data ? "Saved in this transcript" : "Not saved, the link may have expired";
  var icon = plays ? '<button type="button" class="file__play" data-media="' + esc(a.url) + '" data-mime="' + mediaMime(a) + '" data-kind="' + a.kind + '" aria-label="Play ' + name + '" title="Play">' + ICON.play + "</button>"
    : a.kind === "video" || a.kind === "audio" ? ICON.play : ICON.file;
  return '<div class="file' + (data ? " is-saved" : "") + '">' + icon + '<div class="file__meta">' + title +
    '<span class="file__size">' + esc([size, note].filter(Boolean).join(" \u00b7 ")) + "</span></div>" + (data ? '<a class="file__get" href="' + data + '" download="' + name + '" title="Download" aria-label="Download ' + name + '">' + ICON.download + "</a>" : "") + "</div>";
}
function attachmentsHtml(c, list){
  if (!list || !list.length) return "";
  var pics = list.filter(function(a){ return a.kind === "image"; }).map(function(a){ return { media: a, name: a.name, alt: a.alt, spoiler: a.spoiler, badge: a.gif ? "GIF" : "" }; });
  var rest = list.filter(function(a){ return a.kind !== "image"; });
  return gallery(c, pics) + rest.map(function(a){ return fileCard(c, a); }).join("");
}

/* ---------- embeds */
function plain(t){ return emojiText(t || ""); }
function embedHtml(c, e){
  var kind = e.type || "rich", big = e.image || null, thumb = e.thumbnail || null;
  var rich = e.title || e.description || (e.fields && e.fields.length) || (e.author && e.author.name) || (e.footer && e.footer.text);
  /* a bare picture or GIF somebody linked: Discord shows just the picture */
  if ((kind === "image" || kind === "gifv") && !rich) {
    var only = thumb || big;
    if (!only) return "";
    /* small, and a click goes to the original: the still is what is saved, the link is what was posted */
    var still = tile(c, only, { name: kind === "gifv" ? "GIF" : "Image", badge: kind === "gifv" ? "GIF" : "", maxW: 240, maxH: 180, link: isHttp(e.url) ? e.url : "" });
    return '<div class="media">' + still + "</div>";
  }
  /* a video link: the still frame, large, the way Discord shows a player */
  var play = false;
  if (kind === "video" && thumb && !big) { big = thumb; thumb = null; play = true; }
  if (!rich && !big && !thumb && !e.provider) return "";                 // nothing to draw: no empty box
  var html = '<div class="embed"' + (e.color ? ' style="--bar:' + esc(e.color) + '"' : "") + '><div class="embed__grid' + (thumb && src(c, thumb.url) ? " has-thumb" : "") + '"><div class="embed__main">';
  if (e.provider) html += '<p class="embed__provider">' + plain(e.provider) + "</p>";
  if (e.author && e.author.name) {
    var ai = src(c, e.author.icon), an = plain(e.author.name);
    html += '<p class="embed__author">' + (ai ? '<img src="' + esc(ai) + '" alt="" loading="lazy" data-e="gone">' : "") + (isHttp(e.author.url) ? '<a href="' + esc(e.author.url) + '" target="_blank" rel="noopener noreferrer">' + an + "</a>" : "<span>" + an + "</span>") + "</p>";
  }
  if (e.title) html += '<p class="embed__title">' + (isHttp(e.url) ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + inline(c, e.title) + "</a>" : inline(c, e.title)) + "</p>";
  if (e.description) html += '<div class="embed__desc md">' + md(c, e.description) + "</div>";
  var fields = (e.fields || []).filter(function(f){ return f.name || f.value; });
  if (fields.length) {
    var per = thumb ? 2 : 3, row = [];
    html += '<div class="embed__fields">';
    var flush = function(){ if (row.length) { html += '<div class="embed__row" style="--n:' + row.length + '">' + row.join("") + "</div>"; row = []; } };
    fields.forEach(function(f){
      var cell = '<div><p class="embed__fname">' + inline(c, f.name || "") + '</p><div class="md">' + md(c, f.value || "") + "</div></div>";
      if (!f.inline) { flush(); row.push(cell); flush(); } else { row.push(cell); if (row.length === per) flush(); }
    });
    flush(); html += "</div>";
  }
  html += "</div>";
  if (thumb && src(c, thumb.url)) html += '<span class="embed__thumb">' + tile(c, thumb, { name: "Thumbnail", fill: true }) + "</span>";
  html += "</div>";
  if (big) html += '<div class="embed__image">' + tile(c, big, { name: "Image", maxW: 400, maxH: 260, badge: play ? "VIDEO" : "" }) + "</div>";
  if ((e.footer && e.footer.text) || e.timestamp) {
    var fi = src(c, e.footer && e.footer.icon), ft = e.footer && e.footer.text ? plain(e.footer.text) : "";
    html += '<p class="embed__footer">' + (fi ? '<img src="' + esc(fi) + '" alt="" loading="lazy" data-e="gone">' : "") + "<span>" + ft + (ft && e.timestamp ? '<span class="embed__dot">•</span>' : "") + (e.timestamp ? esc(stamp(e.timestamp)) : "") + "</span></p>";
  }
  return html + "</div>";
}

/* ---------- components: buttons and menus, and the newer layout pieces */
var BTN = { 1: "primary", 2: "secondary", 3: "success", 4: "danger", 5: "link", 6: "premium" };
function buttonHtml(c, b){
  var style = BTN[b.style] || "secondary", body = (b.emoji ? emojiOf(c, b.emoji) : "") + (b.label ? "<span>" + plain(b.label) + "</span>" : "");
  var cls = "btn btn--" + style + (b.disabled ? " is-off" : "");
  if (style === "link" && isHttp(b.url) && !b.disabled) return '<a class="' + cls + '" href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">' + body + ICON.link + "</a>";
  return '<span class="' + cls + '">' + body + (style === "link" ? ICON.link : "") + "</span>";
}
function selectHtml(c, s){
  var label = s.chosen ? (s.chosen.emoji ? emojiOf(c, s.chosen.emoji) : "") + "<span>" + plain(s.chosen.label) + "</span>" : '<span class="select__ph">' + plain(s.placeholder || "Make a selection") + "</span>";
  return '<div class="select' + (s.disabled ? " is-off" : "") + '">' + label + ICON.chevron + "</div>";
}
function componentHtml(c, n){
  if (!n) return "";
  var kids = function(){ return (n.components || []).map(function(k){ return componentHtml(c, k); }).join(""); };
  switch (n.type) {
    case 1: return '<div class="row">' + kids() + "</div>";
    case 2: return buttonHtml(c, n);
    case 3: case 5: case 6: case 7: case 8: return selectHtml(c, n);
    case 9: return '<div class="section"><div class="section__text">' + kids() + "</div>" + (n.accessory ? '<div class="section__side">' + componentHtml(c, n.accessory) + "</div>" : "") + "</div>";
    case 10: return '<div class="md">' + md(c, n.content) + "</div>";
    case 11: return '<span class="thumb">' + tile(c, n.media, { name: "Thumbnail", alt: n.alt, spoiler: n.spoiler, fill: true }) + "</span>";
    case 12: return gallery(c, (n.items || []).map(function(it){ return { media: it.media, alt: it.alt, spoiler: it.spoiler, name: "Image" }; }));
    case 13: return fileCard(c, { name: n.name, size: n.size, url: n.url, kind: "file" });
    case 14: return '<div class="sep' + (n.spacing === 2 ? " sep--lg" : "") + (n.divider === false ? " sep--blank" : "") + '"></div>';
    case 17: return '<div class="box' + (n.color ? " has-bar" : "") + (n.spoiler ? " is-spoiler" : "") + '"' + (n.color ? ' style="--bar:' + esc(n.color) + '"' : "") + ">" + kids() + (n.spoiler ? '<span class="pic__veil">SPOILER</span>' : "") + "</div>";
    default: return kids();
  }
}

/* ---------- the rest of a message */
function reactionsHtml(c, list){
  if (!list || !list.length) return "";
  return '<div class="reactions">' + list.map(function(r){ return '<span class="reaction">' + emojiOf(c, r.emoji) + "<span>" + esc(r.count) + "</span></span>"; }).join("") + "</div>";
}
function stickersHtml(c, list){
  return (list || []).map(function(s){
    var u = src(c, s.url);
    return u ? '<img class="sticker" src="' + esc(u) + '" alt="' + esc(s.name) + '" title="' + esc(s.name) + '" loading="lazy" data-e="pic" data-n="Sticker">' : '<span class="lost">' + ICON.image + "<span>Sticker: " + esc(s.name) + "</span></span>";
  }).join("");
}
function pollHtml(c, p){
  if (!p) return "";
  var total = (p.answers || []).reduce(function(n, a){ return n + (a.votes || 0); }, 0);
  return '<div class="poll"><p class="poll__q">' + plain(p.question) + "</p>" + (p.answers || []).map(function(a){
    var pct = total ? Math.round((a.votes || 0) * 100 / total) : 0;
    return '<div class="poll__a"><span class="poll__fill" style="width:' + pct + '%"></span><span class="poll__t">' + emojiOf(c, a.emoji) + plain(a.text) + '</span><span class="poll__n">' + plural(a.votes || 0, "vote") + " · " + pct + "%</span></div>";
  }).join("") + '<p class="poll__foot">' + plural(total, "vote") + "</p></div>";
}
function bodyHtml(c, m, o){
  var html = "";
  if (m.content) {
    var text = md(c, m.content, { jumbo: true });
    if (o && o.edited) text = /<\/p>$/.test(text) ? text.replace(/<\/p>$/, ' <span class="edited">(edited)</span></p>') : text + '<span class="edited">(edited)</span>';
    html += '<div class="md">' + text + "</div>";
  }
  html += attachmentsHtml(c, m.attachments);
  html += (m.embeds || []).map(function(e){ return embedHtml(c, e); }).join("");
  html += stickersHtml(c, m.stickers);
  if (m.components && m.components.length) html += '<div class="components">' + m.components.map(function(n){ return componentHtml(c, n); }).join("") + "</div>";
  return html;
}
function replyHtml(c, m){
  if (m.command) {
    return '<div class="ref">' + avatarHtml(c, m.command.user, "ref__av") + nameHtml(c, m.command.user) + '<span class="ref__text">used <span class="cmd">' + ICON.slash + esc(m.command.name ? "/" + m.command.name : "a command") + "</span></span></div>";
  }
  if (!m.reply) return "";
  var t = c.byId[m.reply];
  if (!t) return '<div class="ref ref--gone"><span class="ref__text"><i>Original message was deleted or is outside this transcript.</i></span></div>';
  var text = t.content ? inline(c, String(t.content).split("\n")[0].slice(0, 300)) : "<i>" + ((t.attachments && t.attachments.length) || (t.embeds && t.embeds.length) ? "Click to see attachment" : "Click to see message") + "</i>";
  return '<div class="ref" data-jump="' + esc(t.id) + '" role="button" tabindex="0">' + avatarHtml(c, t.author, "ref__av") + nameHtml(c, t.author) + tagHtml(userOf(c, t.author)) + '<span class="ref__text">' + text + "</span></div>";
}
function forwardHtml(c, f){
  var from = f.from && c.channels[f.from] ? "#" + c.channels[f.from].name : "";
  return '<div class="fwd"><p class="fwd__tag">' + ICON.forward + "<i>Forwarded</i></p>" + bodyHtml(c, f) +
    (from || f.ts ? '<p class="fwd__from">' + esc([from, f.ts ? stamp(f.ts) : ""].filter(Boolean).join(" • ")) + "</p>" : "") + "</div>";
}
var SYSTEM = {
  join: ["join", function(c, m){ return nameHtml(c, m.author) + " joined the server."; }],
  pin: ["pin", function(c, m){ return nameHtml(c, m.author) + " pinned a message to this channel."; }],
  boost: ["boost", function(c, m){ return nameHtml(c, m.author) + " just boosted the server!"; }],
  thread: ["thread", function(c, m){ return nameHtml(c, m.author) + " started a thread: <b>" + esc(m.content || "") + "</b>"; }],
  rename: ["thread", function(c, m){ return nameHtml(c, m.author) + " changed the channel name: <b>" + esc(m.content || "") + "</b>"; }],
  add: ["join", function(c, m){ return nameHtml(c, m.author) + " added " + (m.target ? nameHtml(c, m.target) : "somebody") + " to the thread."; }],
  remove: ["leave", function(c, m){ return nameHtml(c, m.author) + " removed " + (m.target ? nameHtml(c, m.target) : "somebody") + " from the thread."; }],
  "poll-result": ["pin", function(c, m){ return nameHtml(c, m.author) + "'s poll has closed."; }]
};
function messagesHtml(c){
  var out = "", prev = null, open = false;
  c.p.messages.forEach(function(m){
    var d = new Date(m.ts);
    if (!prev || !sameDay(new Date(prev.ts), d)) {
      if (open) { out += "</div>"; open = false; }
      out += '<div class="day"><span>' + esc(longDate(d)) + "</span></div>";
      prev = null;
    }
    var sys = SYSTEM[m.kind];
    if (sys) {
      if (open) { out += "</div>"; open = false; }
      out += '<div class="sys sys--' + sys[0] + '" id="m-' + esc(m.id) + '" data-mid="' + esc(m.id) + '"><span class="sys__icon">' + ICON[sys[0]] + '</span><div class="sys__text">' + sys[1](c, m) + " " + timeHtml(m.ts, "sys__time") + "</div></div>";
      prev = m; return;
    }
    var head = !prev || SYSTEM[prev.kind] || prev.author !== m.author || m.reply || m.command || m.ts - prev.ts > 7 * 60000;
    if (head) {
      if (open) out += "</div>";
      out += '<div class="group">'; open = true;
    }
    var u = userOf(c, m.author), inner = (m.forwarded ? forwardHtml(c, m.forwarded) : bodyHtml(c, m, { edited: !!m.edited })) + pollHtml(c, m.poll) + reactionsHtml(c, m.reactions);
    out += '<div class="msg' + (head ? " msg--head" : "") + '" id="m-' + esc(m.id) + '" data-mid="' + esc(m.id) + '">' +
      (head ? replyHtml(c, m) : "") +
      '<div class="msg__side">' + (head ? avatarHtml(c, m.author, "av") : timeHtml(m.ts, "msg__at", clock(d))) + "</div>" +
      '<div class="msg__main">' +
        (head ? '<div class="msg__head">' + nameHtml(c, m.author, "msg__name") + tagHtml(u) + timeHtml(m.ts, "msg__time") + "</div>" : "") +
        inner +
      "</div></div>";
    prev = m;
  });
  return out + (open ? "</div>" : "");
}

/* ---------- the page around the messages */
function context(payload){
  var c = { p: payload, assets: payload.assets || {}, users: payload.users || {}, roles: payload.roles || {}, channels: payload.channels || {}, byId: {}, now: Date.now() };
  (payload.messages || []).forEach(function(m){ c.byId[m.id] = m; });
  return c;
}
/* The top of the page is two lines: the channel, and one grey line saying where it is from, how
   much was said and for how long. Everything else — who took part, ids, exact times, what was
   skipped — is behind Details, so the conversation starts straight away. Every time is the
   reader's own; the time zone is named there, with the moment the transcript was made in UTC. */
function topLine(c){
  var p = c.p, g = p.guild || {}, msgs = p.messages || [];
  var span = msgs.length > 1 ? msgs[msgs.length - 1].ts - msgs[0].ts : 0;
  return (g.name ? "<span>" + esc(g.name) + "</span>" : "") + "<span>" + plural(msgs.length, "message") + "</span>" + (span > 0 ? "<span>" + lasted(span) + "</span>" : "");
}
/* Who took part. The busiest few are shown; a ticket with a crowd in it keeps the rest folded
   under one line, so thirty people do not push the details off the screen. */
var PEOPLE_SHOWN = 8;
function peopleHtml(c, order, counts){
  if (!order.length) return "";
  var chip = function(k){
    var u = userOf(c, k);
    return '<li data-user="' + esc(k) + '" role="button" tabindex="0">' + avatarHtml(c, k, "tr-people__av") + '<span class="tr-people__n">' + esc(u.name || shown(u)) + '</span><span class="tr-people__c">' + counts[k] + "</span></li>";
  };
  var rest = order.slice(PEOPLE_SHOWN);
  return '<ul class="tr-people">' + order.slice(0, PEOPLE_SHOWN).map(chip).join("") + "</ul>" +
    (rest.length ? '<details class="tr-rest"><summary>' + ICON.chevron + "<span>" + rest.length + " more</span></summary>" + '<ul class="tr-people">' + rest.map(chip).join("") + "</ul></details>" : "");
}
/* The details list, exactly these rows in this order and nothing else. "Created" is when the
   ticket's first message was sent; both dates are the reader's own time with UTC beside it. */
function detailsHtml(c){
  var p = c.p, g = p.guild || {}, ch = p.channel || {}, msgs = p.messages || [], st = p.stats || {};
  var first = msgs.length ? msgs[0].ts : null, last = msgs.length ? msgs[msgs.length - 1].ts : null, made = p.exportedAt || Date.now();
  var id = function(v){ return v ? ' <button class="tr-id" type="button" data-copy="' + esc(v) + '" title="Copy ID">' + esc(v) + "</button>" : ""; };
  var when = function(ms){ return esc(fullDate(new Date(ms))) + ' <span class="tr-dim">(' + esc(utcText(ms)) + ")</span>"; };
  var row = function(k, v){ return v === "" ? "" : "<div><dt>" + k + "</dt><dd>" + v + "</dd></div>"; };
  return row("Server", esc(g.name || "Unknown") + id(g.id)) +
    row("Channel", "#" + esc(ch.name || "unknown") + id(ch.id)) +
    row("Messages", String(msgs.length)) +
    row("Images", String(st.images ? st.images.saved : Object.keys(c.assets).length)) +
    row("Files", String(st.files ? st.files.saved : 0)) +
    row("Duration", first && last && last > first ? lasted(last - first) : "") +
    row("Created", first ? when(first) : "") +
    row("Transcript Generated", when(made));
}
function render(payload, opt){
  var c = context(payload), o = opt || {};
  var g = payload.guild || {}, ch = payload.channel || {}, msgs = payload.messages || [];
  var counts = {}, order = [];
  msgs.forEach(function(m){ if (!m.author) return; if (!counts[m.author]) { counts[m.author] = 0; order.push(m.author); } counts[m.author]++; });
  order.sort(function(a, b){ return counts[b] - counts[a]; });
  var brand = payload.brand || null, icon = src(c, g.icon);

  return '<div class="tr">' +
    '<header class="tr-bar"><span class="tr-bar__hash">' + ICON.hash + '</span><b class="tr-bar__name">' + esc(ch.name || "transcript") + "</b>" +
      (g.name ? '<span class="tr-bar__sep"></span><span class="tr-bar__topic">' + esc(g.name) + "</span>" : "") +
      '<div class="tr-find" id="trFindBox">' + ICON.search + '<input id="trFind" type="text" placeholder="Search" autocomplete="off" spellcheck="false" aria-label="Search this transcript">' +
        '<span class="tr-find__n" id="trFound"></span>' +
        '<button type="button" class="tr-find__b" id="trPrev" title="Previous match (Shift+Enter)" aria-label="Previous match">' + ICON.chevron + "</button>" +
        '<button type="button" class="tr-find__b" id="trNext" title="Next match (Enter)" aria-label="Next match">' + ICON.chevron + "</button>" +
        '<button type="button" class="tr-find__b" id="trClear" title="Clear (Esc)" aria-label="Clear search">' + ICON.close + "</button></div></header>" +
    '<main class="tr-main">' +
      (o.status === "modified" ? '<div class="tr-warn">' + ICON.alert + "<div><b>This transcript was modified.</b><span>The file no longer matches the signature it was exported with, so what it shows may not be what was said.</span></div></div>" : "") +
      '<section class="tr-top">' +
        '<details class="tr-more"><summary>' +
          (icon ? '<img class="tr-top__icon" src="' + esc(icon) + '" alt="" data-e="gone">' : '<span class="tr-top__icon tr-top__icon--hash">' + ICON.hash + "</span>") +
          '<span class="tr-top__title"><b>#' + esc(ch.name || "channel") + '</b><span class="tr-top__line">' + topLine(c) + "</span></span>" +
          '<span class="tr-more__btn">Details' + ICON.chevron + "</span></summary>" +
          '<div class="tr-more__body">' + peopleHtml(c, order, counts) + '<dl class="tr-list">' + detailsHtml(c) + "</dl></div></details>" +
        (payload.truncated ? '<p class="tr-top__note">The ' + plural(payload.truncated, "oldest message") + " " + (payload.truncated === 1 ? "was" : "were") + " skipped to keep this file within its size limit.</p>" : "") +
      "</section>" +
      '<div class="tr-log">' + (msgs.length ? messagesHtml(c) : '<p class="tr-empty">There are no messages in this transcript.</p>') + "</div>" +
      '<footer class="tr-foot"><span>End of transcript</span>' + (brand && brand.name ? "<span>Transcript by " + (isHttp(brand.url) ? '<a href="' + esc(brand.url) + '" target="_blank" rel="noopener noreferrer">' + esc(brand.name) + "</a>" : esc(brand.name)) + "</span>" : "") + "</footer>" +
    "</main>" +
    '<div class="tr-zoom" id="trZoom" hidden><img alt=""></div><div class="tr-pop" id="trPop" hidden></div><div class="tr-menu" id="trMenu" role="menu" hidden></div><div class="tr-toast" id="trToast" hidden></div>' +
  "</div>";
}

/* ---------- reading the packed data, and checking it (browser only) */
function bytesOf(b64){
  var bin = atob(b64), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decode(envelope){
  if (!envelope || envelope.enc !== "gzip+base64" || typeof envelope.data !== "string") return Promise.reject(new Error("Not a transcript."));
  if (envelope.v !== 1) return Promise.reject(new Error("This transcript was made by a newer version."));
  if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser is too old to open the transcript."));
  var stream = new Blob([bytesOf(envelope.data)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text().then(function(t){ return JSON.parse(t); });
}
/* "verified" needs a key the page already trusted. A file cannot vouch for itself: it carries its
   own key, so on its own the most it can say is that it matches the signature it came with. */
function check(envelope, trustedKeys){
  if (!envelope || typeof envelope.sig !== "string" || typeof envelope.key !== "string") return Promise.resolve("unsigned");
  var subtle = root.crypto && root.crypto.subtle;
  if (!subtle) return Promise.resolve("unknown");
  var data, sig, raw;
  try { data = bytesOf(envelope.data); sig = bytesOf(envelope.sig); raw = bytesOf(envelope.key); } catch (e) { return Promise.resolve("modified"); }
  return subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]).then(function(key){
    return subtle.verify({ name: "Ed25519" }, key, sig, data);
  }).then(function(ok){
    if (!ok) return "modified";
    return (trustedKeys || []).indexOf(envelope.key) >= 0 ? "verified" : "intact";
  }, function(){ return "unknown"; });
}

/* A person's card: who they are in this server, from what the export saved about them.
   The few facts everybody wants are shown; roles and permissions are folded away behind a
   line each, so one busy member doesn't fill the screen. */
var PERM = { ManageGuild: "Manage Server", ModerateMembers: "Timeout Members", ManageGuildExpressions: "Manage Expressions" };
function permText(name){ return PERM[name] || String(name).replace(/([a-z])([A-Z])/g, "$1 $2"); }
function fold(title, n, body){
  return '<details class="tr-pop__fold"><summary><span>' + title + '</span><b>' + n + "</b>" + ICON.chevron + "</summary>" + body + "</details>";
}
function profileHtml(c, key){
  var u = userOf(c, key), made = u.id ? createdAt(u.id) : null, count = 0;
  c.p.messages.forEach(function(m){ if (m.author === key) count++; });
  var roles = (u.roles || []).map(function(id){ return c.roles[id]; }).filter(Boolean), perms = u.perms || [];
  var row = function(k, v){ return v ? '<div class="tr-pop__row"><span>' + k + "</span><b>" + v + "</b></div>" : ""; };
  return '<div class="tr-pop__top">' + avatarHtml(c, key, "tr-pop__av") +
      '<div class="tr-pop__who"><p class="tr-pop__name"><span>' + esc(shown(u)) + "</span>" + tagHtml(u) + "</p>" +
      '<p class="tr-pop__user">' + esc(u.name || "") + "</p></div></div>" +
    '<div class="tr-pop__facts">' +
      row(u.bot || u.webhook ? "Created" : "Joined Discord", made ? esc(F_DAY.format(new Date(made))) : "") +
      row("Joined server", u.joined ? esc(F_DAY.format(new Date(u.joined))) : "") +
      row("Messages", String(count)) +
    "</div>" +
    (roles.length ? fold("Roles", roles.length, '<div class="tr-pop__roles">' + roles.map(function(r){ return '<span class="tr-pop__role"><i' + (r.color ? ' style="background:' + esc(r.color) + '"' : "") + "></i>" + esc(r.name) + "</span>"; }).join("") + "</div>") : "") +
    (perms.length ? fold("Permissions", perms.length, '<div class="tr-pop__roles">' + perms.map(function(p){ return '<span class="tr-pop__role">' + esc(permText(p)) + "</span>"; }).join("") + "</div>") : "") +
    (u.id ? '<button class="tr-pop__id" type="button" data-copy="' + esc(u.id) + '" title="Copy user ID"><span>ID</span><code>' + esc(u.id) + "</code><em>Copy</em></button>" : "");
}

/* ---------- the page: the things that answer a click */
function wire(el, c){
  var zoom = el.querySelector("#trZoom"), pop = el.querySelector("#trPop"), menu = el.querySelector("#trMenu"), toast = el.querySelector("#trToast"), toastT = 0;
  function close(){ if (zoom) zoom.hidden = true; if (pop) pop.hidden = true; if (menu) menu.hidden = true; }
  function say(text){ if (!toast) return; toast.textContent = text; toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(function(){ toast.hidden = true; }, 1400); }
  function copy(text, label){
    var done = function(){ say(label || "Copied"); };
    var old = function(){ var t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0"; el.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) { say("Couldn't copy"); } t.remove(); };
    if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, old); else old();
  }
  /* put a floating box where the pointer is, kept inside the window */
  function place(box, x, y){
    box.hidden = false; box.style.left = "0px"; box.style.top = "0px";
    var w = box.offsetWidth, h = box.offsetHeight, vw = root.innerWidth || 1024, vh = root.innerHeight || 768;
    box.style.left = Math.max(8, Math.min(x, vw - w - 8)) + "px";
    box.style.top = Math.max(8, Math.min(y, vh - h - 8)) + "px";
  }
  /* The card opens to the right of the name or avatar it belongs to, level with its top — the
     same place every time, whichever part of it was clicked. In a message that is the avatar's
     column, so a name and its avatar open the card in one spot. */
  function profile(key, from){
    if (!pop || !c.users[key]) return;
    if (menu) menu.hidden = true;
    var row = from.closest && from.closest(".msg"), anchor = (row && !from.closest(".md, .ref") && row.querySelector(".av")) || from;
    var r = anchor.getBoundingClientRect();
    pop.innerHTML = profileHtml(c, key);
    place(pop, r.right + 10, r.top);
  }
  function openMenu(items, x, y){
    if (!menu || !items.length) return;
    if (pop) pop.hidden = true;
    menu.innerHTML = items.map(function(it, i){ return '<button type="button" role="menuitem" data-i="' + i + '">' + esc(it[0]) + "</button>"; }).join("");
    menu._items = items; place(menu, x, y);
  }
  function jumpTo(id){
    var to = el.querySelector("#m-" + (root.CSS && CSS.escape ? CSS.escape(id) : id));
    if (to) { to.scrollIntoView({ block: "center" }); to.classList.remove("is-flash"); void to.offsetWidth; to.classList.add("is-flash"); }
  }
  /* A saved file's bytes as something the browser can play. Made on the first press and kept:
     a transcript can hold megabytes of sound, and none of it is decoded until it is wanted. */
  var blobs = {}, sounding = null;
  function playable(url, mime){
    if (blobs[url]) return blobs[url];
    var data = savedFile(c, url);
    if (!data || !/^(audio|video)\/[a-z0-9.+-]{1,40}$/.test(mime || "")) return null;
    var raw = atob(data.slice(data.indexOf(",") + 1)), bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return (blobs[url] = URL.createObjectURL(new Blob([bytes], { type: mime })));
  }
  function only(player){ if (sounding && sounding !== player) sounding.pause(); sounding = player; }
  /* a voice message: play and pause in place, the bars filling as it goes; a press on the bars seeks */
  function voice(box, seek){
    var au = box._audio, total = +box.getAttribute("data-secs") || 0;
    var len = function(){ return au && isFinite(au.duration) && au.duration ? au.duration : total; };
    if (au) {
      if (seek != null && len()) { au.currentTime = seek * len(); if (au.paused) au.play().catch(function(){}); }
      else if (au.paused) au.play().catch(function(){}); else au.pause();
      return;
    }
    var src = playable(box.getAttribute("data-play"), box.getAttribute("data-mime"));
    if (!src) return;
    au = box._audio = new Audio(src);
    var lines = box.querySelectorAll(".voice__wave i"), time = box.querySelector(".voice__time");
    var draw = function(){
      var at = len() ? au.currentTime / len() : 0;
      for (var i = 0; i < lines.length; i++) lines[i].classList.toggle("is-on", (i + .5) / lines.length <= at);
      if (time) time.textContent = clock(au.currentTime || len());
    };
    au.addEventListener("play", function(){ only(au); box.classList.add("is-playing"); });
    au.addEventListener("pause", function(){ box.classList.remove("is-playing"); });
    au.addEventListener("timeupdate", draw);
    au.addEventListener("ended", function(){ au.currentTime = 0; draw(); });
    au.addEventListener("error", function(){ box.classList.add("is-off"); say("This browser can't play that"); });
    if (seek != null) au.addEventListener("loadedmetadata", function(){ if (len()) au.currentTime = seek * len(); }, { once: true });
    au.play().catch(function(){});
  }
  /* any other saved sound or video: the browser's own player, put under the file on the first press */
  function media(btn){
    var card = btn.closest(".file"), src = playable(btn.getAttribute("data-media"), btn.getAttribute("data-mime"));
    if (!card || !src) return;
    var pl = document.createElement(btn.getAttribute("data-kind") === "video" ? "video" : "audio");
    pl.className = "player player--" + pl.tagName.toLowerCase();
    pl.controls = true; pl.autoplay = true; pl.src = src;
    pl.addEventListener("play", function(){ only(pl); });
    pl.addEventListener("error", function(){ pl.remove(); say("This browser can't play that"); });
    card.parentNode.insertBefore(pl, card.nextSibling);
    btn.removeAttribute("data-media"); btn.disabled = true;
  }
  function act(t, e){
    var vb = t.closest(".voice[data-play]");
    if (vb) {
      var wave = t.closest(".voice__wave"), box = wave && wave.getBoundingClientRect();
      if (t.closest(".voice__btn")) voice(vb); else if (box && box.width) voice(vb, Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
      return true;
    }
    var mb = t.closest("[data-media]");
    if (mb) { media(mb); return true; }
    var sp = t.closest(".spoiler, .is-spoiler");
    if (sp && !sp.classList.contains("is-open")) { sp.classList.add("is-open"); return true; }
    var who = t.closest("[data-user]");
    if (who && !t.closest(".ref")) { profile(who.getAttribute("data-user"), who); return true; }
    var jump = t.closest("[data-jump]");
    if (jump) { jumpTo(jump.getAttribute("data-jump")); return true; }
    var pic = t.closest("[data-zoom]");
    if (pic && zoom) { var im = pic.querySelector("img"); if (im) { zoom.querySelector("img").src = im.src; zoom.hidden = false; } return true; }
    return false;
  }
  el.addEventListener("click", function(e){
    var t = e.target;
    if (zoom && !zoom.hidden && t.closest("#trZoom")) { close(); return; }
    var item = t.closest("#trMenu button");
    if (item) { var it = menu._items[+item.getAttribute("data-i")]; menu.hidden = true; if (it) it[1](); return; }
    var cp = t.closest("[data-copy]");
    if (cp) { copy(cp.getAttribute("data-copy"), "Copied ID"); return; }
    if (t.closest("#trPop")) return;
    if (t.closest("a") || t.closest("#trFindBox")) { close(); if (t.closest("a[download]")) say("Downloading"); return; }
    if (!act(t, e)) close();
  });
  /* Right-click: the things worth copying. A link, a picture's own menu or selected text keeps
     the browser's menu, and so does anything while Shift is held. */
  el.addEventListener("contextmenu", function(e){
    var t = e.target, sel = root.getSelection ? String(root.getSelection()) : "";
    if (e.shiftKey || sel || t.closest("a, input, #trZoom")) return;
    /* On a person: only what is about that person. Anywhere else in a message: only what is about
       the message. Never both at once. */
    var who = t.closest("[data-user]"), msg = who ? null : t.closest("[data-mid]"), items = [];
    if (who) {
      var key = who.getAttribute("data-user"), u = c.users[key];
      if (u) {
        items.push(["Profile", function(){ profile(key, who); }]);
        items.push(["Copy Username", function(){ copy(u.name || "", "Copied username"); }]);
        if (u.id) items.push(["Copy User ID", function(){ copy(u.id, "Copied ID"); }]);
      }
    }
    if (msg) {
      var m = c.byId[msg.getAttribute("data-mid")];
      if (m) {
        var text = m.content || (m.forwarded && m.forwarded.content) || "";
        if (text) items.push(["Copy Text", function(){ copy(text, "Copied text"); }]);
        items.push(["Copy Message ID", function(){ copy(m.id, "Copied ID"); }]);
        if (c.p.guild && c.p.guild.id && c.p.channel && c.p.channel.id) items.push(["Copy Message Link", function(){ copy("https://discord.com/channels/" + c.p.guild.id + "/" + c.p.channel.id + "/" + m.id, "Copied link"); }]);
      }
    }
    if (!items.length) return;
    e.preventDefault();
    openMenu(items, e.clientX, e.clientY);
  });
  el.addEventListener("keydown", function(e){
    if (e.key === "Escape") { close(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[role=button]")) { if (act(e.target)) e.preventDefault(); }
  });
  if (root.addEventListener) root.addEventListener("scroll", function(){ if (menu) menu.hidden = true; }, { passive: true });

  /* Search marks every match where it stands and nothing is hidden, so the conversation around
     a match is still there to read. Typing only marks and counts — the page does not jump about
     under a half-typed word. Enter or the down arrow goes to the next match, Shift+Enter or the
     up arrow to the one before, and Esc or the cross clears it. */
  var find = el.querySelector("#trFind"), box = el.querySelector("#trFindBox"), found = el.querySelector("#trFound"), log = el.querySelector(".tr-log"), hits = [], at = -1, findT = 0;
  function label(){
    var q = find.value.trim();
    if (box) box.classList.toggle("is-on", !!q);
    if (found) found.textContent = !q ? "" : !hits.length ? "No results" : at < 0 ? hits.length + (hits.length === 1 ? " result" : " results") : (at + 1) + " of " + hits.length;
  }
  function clearHits(){
    hits.forEach(function(m){ var p = m.parentNode; if (p) { m.replaceWith(document.createTextNode(m.textContent)); p.normalize(); } });
    hits = []; at = -1;
  }
  function step(by){
    if (!hits.length) return;
    if (hits[at]) hits[at].classList.remove("is-on");
    at = at < 0 ? (by > 0 ? 0 : hits.length - 1) : (at + by + hits.length) % hits.length;
    hits[at].classList.add("is-on");
    hits[at].scrollIntoView({ block: "center" });
    label();
  }
  function search(){
    clearHits();
    var q = find.value.trim().toLowerCase();
    if (q && log) {
      /* collect the text first, then wrap: changing the page while walking it would skip nodes */
      var walk = document.createTreeWalker(log, 4), nodes = [], n;
      while ((n = walk.nextNode())) if (n.nodeValue.toLowerCase().indexOf(q) >= 0) nodes.push(n);
      nodes.forEach(function(node){
        var text = node.nodeValue, low = text.toLowerCase(), from = 0, i, frag = document.createDocumentFragment();
        while ((i = low.indexOf(q, from)) >= 0 && hits.length < 2000) {
          frag.appendChild(document.createTextNode(text.slice(from, i)));
          var m = document.createElement("mark"); m.className = "hit"; m.textContent = text.slice(i, i + q.length);
          frag.appendChild(m); hits.push(m); from = i + q.length;
        }
        frag.appendChild(document.createTextNode(text.slice(from)));
        node.parentNode.replaceChild(frag, node);
      });
    }
    label();
  }
  function reset(){ clearTimeout(findT); find.value = ""; search(); }
  if (find) {
    find.addEventListener("input", function(){ clearTimeout(findT); findT = setTimeout(search, 150); });
    find.addEventListener("keydown", function(e){
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); clearTimeout(findT);
        if (!hits.length && find.value.trim()) search();
        step(e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? -1 : 1);
      }
      if (e.key === "Escape") { e.stopPropagation(); reset(); find.blur(); }
    });
    var on = function(id, fn){ var b = el.querySelector(id); if (b) b.addEventListener("click", function(e){ e.stopPropagation(); fn(); }); };
    on("#trPrev", function(){ step(-1); }); on("#trNext", function(){ step(1); }); on("#trClear", function(){ reset(); find.focus(); });
  }

  /* a picture that will not load: an emoji falls back to its text, an avatar to an initial,
     anything else to a line saying it is gone. Listened for here because "error" does not bubble. */
  el.addEventListener("error", function(e){
    var im = e.target;
    if (!im || im.tagName !== "IMG") return;
    var kind = im.getAttribute("data-e");
    if (kind === "emoji") { im.replaceWith(document.createTextNode(im.alt)); return; }
    if (kind === "avatar") { var s = document.createElement("span"); s.className = im.className + " av--blank"; s.textContent = (im.getAttribute("data-n") || "?").toUpperCase(); if (im.getAttribute("data-user")) s.setAttribute("data-user", im.getAttribute("data-user")); im.replaceWith(s); return; }
    if (kind === "pic") { var box = im.closest(".pic") || im, w = document.createElement("span"); w.className = "pic is-lost"; w.innerHTML = missing(im.getAttribute("data-n")); box.replaceWith(w); return; }
    im.remove();
  }, true);
}
function fail(el, text){ el.innerHTML = '<div class="tr"><div class="tr-error">' + ICON.alert + "<b>This transcript cannot be opened.</b><span>" + esc(text) + "</span></div></div>"; }

/* Shows a transcript in `el`. `envelope` is the object from a file's transcript-data block. */
function mount(el, envelope, opt){
  var o = opt || {};
  return Promise.all([decode(envelope), check(envelope, o.trustedKeys)]).then(function(got){
    el.innerHTML = render(got[0], { status: got[1] });
    wire(el, context(got[0]));
    return { status: got[1], payload: got[0] };
  }, function(err){
    /* data that will not unpack is the plainest kind of modified */
    fail(el, envelope && envelope.sig ? "The file is damaged or was changed after it was exported." : (err && err.message) || "The file is damaged.");
    return { status: "modified", payload: null };
  });
}

root.UtilTranscript = { render: render, mount: mount, decode: decode, check: check, emojiUrl: emojiUrl };

/* a transcript file opens itself */
if (typeof document !== "undefined") {
  var boot = function(){
    var data = document.getElementById("transcript-data"), el = document.getElementById("transcript");
    if (!data || !el || el.getAttribute("data-mounted")) return;
    el.setAttribute("data-mounted", "1");
    var envelope = null;
    try { envelope = JSON.parse(data.textContent); } catch (e) { fail(el, "The file is damaged."); return; }
    mount(el, envelope, { trustedKeys: root.UtilTranscriptTrustedKeys });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
}
})(typeof window !== "undefined" ? window : globalThis);
