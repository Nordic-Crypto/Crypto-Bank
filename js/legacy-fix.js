/* ============================================================
   NORDIC CRYPTO — LEGACY-FIX.JS v1.0
   ============================================================
   Загружается ПОСЛЕ app.legacy.js.
   Патчит 3 функции, чтобы клики работали
   с applyAccountType() и inline display:none.
   ============================================================ */

(function () {
  'use strict';

  // FIX 1: initNav — навигация по сайдбару
  window.initNav = function () {
    var mis = document.querySelectorAll('.mi');
    for (var i = 0; i < mis.length; i++) {
      mis[i].onclick = function () {
        var p = this.getAttribute('data-p');
        var pgs = document.querySelectorAll('.pg');
        for (var j = 0; j < pgs.length; j++) {
          pgs[j].classList.remove('on');
          pgs[j].style.display = 'none';
        }
        var page = document.getElementById(p);
        if (page) {
          page.classList.add('on');
          page.style.display = 'block';
        }
        var ms = document.querySelectorAll('.mi');
        for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
        this.classList.add('on');

        if (p === 'dash') {
          setTimeout(function () {
            if (typeof window.applyAccountType === 'function') window.applyAccountType();
            if (typeof window.render === 'function') window.render();
          }, 50);
        }
      };
    }
  };

  // FIX 2: initRecentTx — кнопка "View all"
  window.initRecentTx = function () {
    var viewAll = document.getElementById('viewAllTx');
    if (viewAll) viewAll.onclick = function (e) {
      e.preventDefault();
      var pgs = document.querySelectorAll('.pg');
      for (var i = 0; i < pgs.length; i++) {
        pgs[i].classList.remove('on');
        pgs[i].style.display = 'none';
      }
      var txPg = document.getElementById('tx');
      if (txPg) {
        txPg.classList.add('on');
        txPg.style.display = 'block';
      }
      var ms = document.querySelectorAll('.mi');
      for (var j = 0; j < ms.length; j++) ms[j].classList.remove('on');
      var txMi = document.querySelector('.mi[data-p="tx"]');
      if (txMi) txMi.classList.add('on');
    };
  };

  // FIX 3: initCardActions — кнопка "Order Physical Card"
  var _origInitCardActions = window.initCardActions;
  window.initCardActions = function () {
    if (typeof _origInitCardActions === 'function') {
      try { _origInitCardActions(); } catch (e) { console.warn('[fix] initCardActions error:', e); }
    }
    var btnGoOrder = document.getElementById('btnGoOrder');
    if (btnGoOrder) {
      btnGoOrder.onclick = function () {
        var pgs = document.querySelectorAll('.pg');
        for (var j = 0; j < pgs.length; j++) {
          pgs[j].classList.remove('on');
          pgs[j].style.display = 'none';
        }
        var orderPg = document.getElementById('order');
        if (orderPg) {
          orderPg.classList.add('on');
          orderPg.style.display = 'block';
        }
        var ms = document.querySelectorAll('.mi');
        for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
        var orderMi = document.querySelector('.mi[data-p="order"]');
        if (orderMi) orderMi.classList.add('on');
      };
    }
  };

  // Перезапускаем с патчами (legacy уже вызвал их один раз)
  setTimeout(function () {
    if (typeof window.initNav === 'function') window.initNav();
    if (typeof window.initRecentTx === 'function') window.initRecentTx();
    if (typeof window.initCardActions === 'function') window.initCardActions();
    console.log('%c[NordicCrypto] 🔧 legacy-fix.js applied', 'color:#22d3ee;font-weight:bold');
  }, 100);

})();
