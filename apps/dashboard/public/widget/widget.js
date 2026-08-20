"use strict";(()=>{var d="gigachad-widget";function h(e){return typeof e=="object"&&e!==null&&e.ns===d&&typeof e.type=="string"}var u="gc-widget-launcher",m="gc-widget-badge",p="gc-widget-iframe";function x(){let e=document.currentScript;if(e instanceof HTMLScriptElement)return e;let n=document.querySelectorAll('script[src*="widget.js"]'),t=n[n.length-1];if(!t)throw new Error("gigachad widget: could not locate its own <script> tag.");return t}function b(e,n){let t=new URL("./panel/index.html",e);return t.searchParams.set("wk",n),t.href}async function A(e){try{let n=await fetch("http://localhost:3000/api/v1/widget/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({widgetKey:x().dataset.widgetKey,visitorToken:e})}),t=await n.json().catch(()=>null);return!n.ok||!t||!("data"in t)?{session:null,sessionError:t&&"error"in t?t.error.message:"Could not start a chat session."}:{session:t.data}}catch{return{session:null,sessionError:"Could not reach the chat server."}}}function S(){let e=document.createElement("style");e.id="gc-widget-styles",e.textContent=`
    #${u} {
      position: fixed;
      right: 20px;
      bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      z-index: 2147483000;
      width: 56px;
      height: 56px;
      border-radius: 9999px;
      border: none;
      background: #2563eb;
      color: #fff;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font: 500 24px/1 system-ui, sans-serif;
    }
    #${u}:focus-visible {
      outline: 2px solid #93c5fd;
      outline-offset: 2px;
    }
    #${m} {
      position: absolute;
      top: -2px;
      right: -2px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 9999px;
      background: #dc2626;
      color: #fff;
      font: 600 11px/18px system-ui, sans-serif;
      text-align: center;
    }
    #${p} {
      position: fixed;
      right: 20px;
      bottom: calc(88px + env(safe-area-inset-bottom, 0px));
      z-index: 2147483000;
      width: 380px;
      max-width: calc(100vw - 24px);
      height: 600px;
      max-height: calc(100dvh - 120px);
      border: none;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
      display: none;
      color-scheme: light;
    }
    /* Below 480px the panel goes full-screen rather than floating \u2014 a 380px
       card on a 375px viewport is unusable (docs/15-frontend-and-widget.md). */
    @media (max-width: 480px) {
      #${p} {
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100dvh;
        max-width: 100vw;
        max-height: 100dvh;
        border-radius: 0;
      }
    }
    #${p}.gc-open {
      display: block;
    }
  `,document.head.appendChild(e)}function y(){let e=x(),n=e.dataset.widgetKey;if(!n){console.error("gigachad widget: missing data-widget-key on the script tag.");return}let t=b(e.src,n),s=null,r=!1,f=!1;S();let i=document.createElement("button");i.id=u,i.type="button",i.setAttribute("aria-label","Open chat"),i.setAttribute("aria-haspopup","dialog"),i.textContent="\u{1F4AC}";let a=document.createElement("span");a.id=m,a.style.display="none",i.appendChild(a);function l(o){s?.contentWindow?.postMessage(o,new URL(t).origin)}function E(){return s||(s=document.createElement("iframe"),s.id=p,s.src=t,s.title="Chat",s.setAttribute("role","dialog"),s.allow="",document.body.appendChild(s),s)}function w(){r=!0,E().classList.add("gc-open"),i.setAttribute("aria-expanded","true"),f&&l({ns:d,type:"open"}),a.style.display="none"}function g(){r=!1,s?.classList.remove("gc-open"),i.setAttribute("aria-expanded","false"),l({ns:d,type:"close"}),i.focus()}i.addEventListener("click",()=>{r?g():w()}),document.addEventListener("keydown",o=>{o.key==="Escape"&&r&&g()}),window.addEventListener("message",o=>{if(o.origin!==new URL(t).origin||!h(o.data))return;let c=o.data;switch(c.type){case"ready":f=!0,A(c.visitorToken).then(M=>{l({ns:d,type:"init",widgetKey:n,hostPageUrl:location.href,locale:navigator.language,apiUrl:"http://localhost:3000",wsUrl:"http://localhost:3000",...M}),r&&l({ns:d,type:"open"})});break;case"resize":s&&window.innerWidth>480&&(s.style.height=`${Math.min(Math.max(c.height,320),720)}px`);break;case"unread":c.count>0&&!r?(a.textContent=c.count>9?"9+":String(c.count),a.style.display="block"):a.style.display="none";break;case"closeRequest":r&&g();break}}),document.body.appendChild(i)}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",y):y();})();
