// ==UserScript==
// @name         Dodací list · Tomáš Němec
// @namespace    https://pokorinek.cz/
// @version      3.0.0
// @description  Zvýrazňuje množství nad 1 ks a tiskne čitelný dodací list (dopravce, velké názvy, kódy, množství, adresa) s náhledy produktů. Funguje v seznamu objednávek i v detailu objednávky.
// @author       Tomáš Němec
// @match        https://pokorinek.cz/admin/*
// @match        https://www.pokorinek.cz/admin/*
// @match        https://793879.myshoptet.com/admin/*
// @homepageURL  https://github.com/tomasnemec-git/dodaci-listy
// @updateURL    https://raw.githubusercontent.com/tomasnemec-git/dodaci-listy/main/korinek-dodaci-list.user.js
// @downloadURL  https://raw.githubusercontent.com/tomasnemec-git/dodaci-listy/main/korinek-dodaci-list.user.js
// @noframes
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // NASTAVENÍ — upravte podle potřeby
    // ------------------------------------------------------------------
    // Logo vlevo nahoře: adresa obrázku. Prázdné = místo loga nápis „Dodací list“.
    var LOGO_URL = 'https://cdn.myshoptet.com/usr/www.pokorinek.cz/user/logos/pokorinek-logo.jpg';

    var DODAVATEL = [
        '<strong>PRACOVNÍ ODĚVY KOŘÍNEK, s.r.o.</strong>',
        'Bernolákova 1166/5',
        '14200 Praha',
        'Česká republika',
        'IČ: 05015685, DIČ: CZ05015685',
        'obchod@pokorinek.cz',
        'www.pokorinek.cz'
    ];
    var VELIKOST_NAHLEDU_MM = 20;   // velikost obrázku produktu na listu
    var SOUBEZNE_POZADAVKY = 4;     // kolik objednávek načítat najednou

    // Dopravci: na listu se tiskne jen název dopravce (name).
    // Když způsob dopravy zmiňuje víc dopravců (např. „GLS/ALZA/DPD BOX - výdejní místa“),
    // platí ten, který je v názvu uveden jako první.
    // Když skript dopravce nepozná, vytiskne celý název způsobu dopravy ze Shoptetu.
    var DOPRAVCI = [
        { match: /balíkovn|balikovn/i, name: 'Balíkovna' },
        { match: /česká pošta|ceska posta|\bpošta\b|\bposta\b/i, name: 'Česká pošta' },
        { match: /zásilkovn|zasilkovn|packeta/i, name: 'Zásilkovna' },
        { match: /\bppl\b/i, name: 'PPL' },
        { match: /\bdpd\b/i, name: 'DPD' },
        { match: /\bgls\b/i, name: 'GLS' },
        { match: /\bdhl\b/i, name: 'DHL' },
        { match: /we\s*\|\s*do|\bwedo\b/i, name: 'WE|DO' }
    ];

    // Osobní odběr na prodejně: místo způsobu dopravy se nahoře vytiskne jen název prodejny,
    // tak jak je ve Shoptetu (text za „na prodejně“, např. „Letenské náměstí“).
    // Kdybyste chtěl některou prodejnu na listu pojmenovat jinak, přidejte ji sem,
    // např. { match: /letensk/i, name: 'Milady Horákové' }
    var PRODEJNY = [];
    var ODBER_RE = /osobní odběr|osobni odber|vyzvednutí na prodejně|na prodejně/i;
    // Platby, které se platí až při vyzvednutí → pod prodejnou se vytiskne „Nezaplaceno“
    // (platba na prodejně, dobírka, platba při převzetí). Všechno ostatní = „Placeno“.
    var PLATBA_NA_PRODEJNE_RE = /v hotovosti nebo kartou na prodejně|hotovost.*prodejn|kartou na prodejně|dobírk|dobirk|při převzetí|pri prevzeti/i;

    // Adresa, ze které si Shoptet bere náhled objednávky při najetí myší
    var DETAIL_URL = '/admin/action/OrdersListing/GetOrderDetail/?id=';
    // Stránka detailu objednávky (odtud se bere datum vytvoření, když není v seznamu)
    var ORDER_PAGE_URL = '/admin/objednavky-detail/?id=';

    var LS_NAME = 'korinekDL.tiskne';
    var NAZEV = 'Dodací list · Tomáš Němec';

    // Nastavení přepínaná v okénku u ikonky (ukládá se v tomto prohlížeči)
    var LS_SETTINGS = 'korinekDL.nastaveni';
    function getSet(k) {
        var d = { zapnuto: true, konfety: EFEKT_KONFETY, zvyrazneni: ZVYRAZNIT_MNOZSTVI, zvuk: ZVUK };
        try {
            var st = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}');
            return k in st ? !!st[k] : d[k];
        } catch (e) { return d[k]; }
    }
    function setSet(k, v) {
        try {
            var st = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}');
            st[k] = !!v;
            localStorage.setItem(LS_SETTINGS, JSON.stringify(st));
        } catch (e) { /* nic */ }
    }
    // Jméno přihlášeného uživatele v hlavičce administrace
    var ADMIN_NAME_SEL = '.headerNavigation__userName';

    // ------------------------------------------------------------------
    // Pomocné funkce
    // ------------------------------------------------------------------
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function txt(el) {
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    function linesFromBr(el) {
        if (!el) return [];
        return el.innerHTML.split(/<br\s*\/?>/i).map(function (part) {
            var d = el.ownerDocument.createElement('div');
            d.innerHTML = part;
            return txt(d);
        }).filter(Boolean);
    }
    function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* nic */ } }

    // ------------------------------------------------------------------
    // Datum vytvoření objednávky
    // ------------------------------------------------------------------
    var DATE_RE = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/;
    var LABELED_RE = /(?:datum\s+vytvoření|vytvořen[oa]?|datum\s+objednávky|datum\s+přijetí|objednáno)\s*:?\s*(\d{1,2}\.\s?\d{1,2}\.\s?\d{4}(?:\s+\d{1,2}:\d{2})?)/i;

    function formatDate(s) {
        var m = DATE_RE.exec(s || '');
        if (!m) return '';
        return (+m[1]) + '. ' + (+m[2]) + '. ' + m[3] + (m[4] ? ' ' + (+m[4]) + ':' + m[5] : '');
    }
    function findCreatedDate(text, preferLabel) {
        text = (text || '').replace(/\s+/g, ' ');
        var m = LABELED_RE.exec(text);
        if (m) return formatDate(m[1]);
        if (preferLabel) {
            // bez popisku vezmeme první datum s časem, jinak první datum
            var withTime = /\d{1,2}\.\s?\d{1,2}\.\s?\d{4}\s+\d{1,2}:\d{2}/.exec(text);
            if (withTime) return formatDate(withTime[0]);
        }
        var any = DATE_RE.exec(text);
        return any ? formatDate(any[0]) : '';
    }
    function loadCreatedDate(id) {
        return fetch(ORDER_PAGE_URL + encodeURIComponent(id), { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.text() : ''; })
            .then(function (html) {
                if (!html) return '';
                var doc = new DOMParser().parseFromString(html, 'text/html');
                doc.querySelectorAll('script,style').forEach(function (e) { e.remove(); });
                var main = doc.querySelector('main, #content, .content, .main') || doc.body;
                return findCreatedDate(main ? main.textContent : '', true);
            })
            .catch(function () { return ''; });
    }

    // Sloupec množství může obsahovat víc čísel (červené = není skladem,
    // žluté = zkompletováno, poslední = celkem). Bereme jen poslední číslo a jednotku.
    function parseQty(t) {
        t = (t || '').trim();
        if (!t) return { text: '', num: null };
        // jednotka může obsahovat číslici (m2, m3), ale nesmí jí začínat
        var m = /(\d+(?:[.,]\d+)?)\s*([^\d\s\/|.,][^\s\/|]*)?\s*$/.exec(t);
        if (!m) return { text: t, num: null };
        return {
            text: m[1] + (m[2] ? ' ' + m[2] : ''),
            num: parseFloat(m[1].replace(',', '.'))
        };
    }

    // ------------------------------------------------------------------
    // Rozbor odpovědi GetOrderDetail (HTML fragment)
    // ------------------------------------------------------------------
    function parseOrder(html, id) {
        var doc = new DOMParser().parseFromString('<div id="root">' + html + '</div>', 'text/html');
        var root = doc.getElementById('root');
        var q = function (sel) { return root.querySelector(sel); };

        var order = {
            id: id,
            number: txt(q('.preview-item-number')),
            customer: txt(q('.preview-item-customer a')),
            email: txt(q('.preview-item-email a')),
            phone: txt(q('.preview-item-phone')),
            address: linesFromBr(q('.preview-item-address')),
            shipping: txt(q('.preview-item-shipping')),
            payment: txt(q('.preview-item-blank')),
            status: txt(q('.preview-item-status')),
            total: txt(q('.preview-price .green')) || txt(q('.preview-price')).replace(/^.*?:\s*/, ''),
            created: '',
            items: [],
            extras: []
        };

        root.querySelectorAll('table tbody tr').forEach(function (tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length < 6) return;
            var img = tds[0].querySelector('img');
            var code = txt(tds[1]);
            var link = tds[2].querySelector('a');
            var qty = parseQty(txt(tds[4]));
            var price = txt(tds[5]);

            if (!code && !img && !qty.text) {
                order.extras.push({ name: txt(tds[2]), price: price });
                return;
            }

            var nameCell = link || tds[2];
            var variant = txt(nameCell.querySelector('.grey'));
            var clone = nameCell.cloneNode(true);
            clone.querySelectorAll('.grey').forEach(function (e) { e.remove(); });

            order.items.push({
                img: img ? img.getAttribute('src') : '',
                code: code,
                name: txt(clone),
                variant: variant.replace(/^Varianta:\s*/i, ''),
                qty: qty.text,
                qtyNum: qty.num,
                price: price
            });
        });

        // Když se doručovací adresa liší od fakturační, Shoptet před ni dává popisek
        // „Doručovací adresa“ (na stejném řádku jako jméno). Popisek oddělíme.
        order.deliveryAddress = false;
        if (order.address.length) {
            var first = order.address[0].replace(/^doručovací adresa\s*:?\s*/i, '');
            if (first !== order.address[0]) {
                order.deliveryAddress = true;
                if (first) order.address[0] = first; else order.address.shift();
            }
        }

        return order;
    }

    function loadOrder(job) {
        return fetch(DETAIL_URL + encodeURIComponent(job.id), {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        }).then(function (html) {
            var o = parseOrder(html, job.id);
            if (job.created) { o.created = job.created; return o; }
            return loadCreatedDate(job.id).then(function (d) { o.created = d; return o; });
        });
    }

    function loadAll(jobs, onProgress) {
        var results = new Array(jobs.length);
        var next = 0, done = 0;
        function worker() {
            if (next >= jobs.length) return Promise.resolve();
            var i = next++;
            return loadOrder(jobs[i]).then(function (o) {
                results[i] = o;
            }, function (err) {
                results[i] = { id: jobs[i].id, error: err.message };
            }).then(function () {
                onProgress(++done, jobs.length);
                return worker();
            });
        }
        var workers = [];
        for (var w = 0; w < Math.min(SOUBEZNE_POZADAVKY, jobs.length); w++) workers.push(worker());
        return Promise.all(workers).then(function () { return results; });
    }

    // ------------------------------------------------------------------
    // Sestavení tiskové stránky
    // ------------------------------------------------------------------
    function storeFromShipping(shipping) {
        if (!ODBER_RE.test(shipping || '')) return null;
        for (var i = 0; i < PRODEJNY.length; i++) {
            if (PRODEJNY[i].match.test(shipping)) return PRODEJNY[i].name;
        }
        // neznámá prodejna: vezmeme text za „na prodejně“
        var m = /na prodejně\s+(.+)$/i.exec(shipping);
        return m ? m[1] : shipping;
    }

    // 'unpaid' = platba na prodejně, 'paid' = jakákoli jiná platba, null = platbu se nepodařilo najít
    function storePaymentState(o) {
        // řádek dopravy („Osobní odběr na prodejně …“) není platba;
        // pozor: platba „V hotovosti nebo kartou na prodejně“ taky obsahuje „na prodejně“
        var payments = o.extras.filter(function (x) {
            return x.name && x.name !== o.shipping && !/osobní odběr|osobni odber/i.test(x.name);
        });
        if (!payments.length) return null;
        return payments.some(function (x) { return PLATBA_NA_PRODEJNE_RE.test(x.name); }) ? 'unpaid' : 'paid';
    }

    function headerBox(o) {
        var store = storeFromShipping(o.shipping);
        if (!store) return carrierBanner(o.shipping);
        var size = store.length <= 12 ? 26 : store.length <= 18 ? 21 : 16;
        return '<div class="carrier store">' +
            '<span class="carrier-name" style="font-size:' + size + 'pt">' + esc(store) + '</span>' +
            (function () {
                var st = storePaymentState(o);
                if (st === 'unpaid') return '<span class="paystate unpaid">Nezaplaceno</span>';
                if (st === 'paid') return '<span class="paystate">Placeno</span>';
                return '';
            })() +
            '</div>';
    }

    // dopravce, jehož název je ve způsobu dopravy nejdřív
    function carrierFromShipping(shipping) {
        var best = null, bestPos = Infinity;
        DOPRAVCI.forEach(function (c) {
            var m = c.match.exec(shipping || '');
            if (m && m.index < bestPos) { best = c; bestPos = m.index; }
        });
        return best;
    }

    function carrierBanner(shipping) {
        var c = carrierFromShipping(shipping);
        var label = c ? c.name : (shipping || 'Doprava neuvedena');
        var size = label.length <= 12 ? 26 : label.length <= 18 ? 21 : label.length <= 28 ? 16 : 12;
        return '<div class="carrier">' +
            '<span class="carrier-name" style="font-size:' + size + 'pt">' + esc(label) + '</span>' +
            '</div>';
    }

    function renderOrder(o, info) {
        if (o.error) {
            return '<section class="dl" data-no="ID ' + esc(o.id) + '"><h1>Objednávku (ID ' + esc(o.id) +
                ') se nepodařilo načíst</h1><p>' + esc(o.error) + '</p></section>';
        }

        var warn = o.items.length ? '' :
            '<div class="warn">POZOR: u této objednávky se nenašly žádné položky. ' +
            'Zkontrolujte ji v administraci, list nemusí být úplný.</div>';

        var rows = o.items.map(function (it) {
            return '<tr class="item">' +
                '<td class="img">' + (it.img ? '<img src="' + esc(it.img) + '" alt="">' : '') + '</td>' +
                '<td class="prod">' +
                    '<div class="name">' + esc(it.name) + '</div>' +
                    (it.variant ? '<div class="var">' + esc(it.variant) + '</div>' : '') +
                    (it.code ? '<div class="code">Kód: <b>' + esc(it.code) + '</b></div>' : '') +
                '</td>' +
                '<td class="qty' + (it.qtyNum === 1 ? '' : ' multi') + '"><span>' + esc(it.qty) + '</span></td>' +
                '<td class="price">' + esc(it.price) + '</td>' +
                '</tr>';
        }).join('');

        var extras = o.extras.map(function (x) {
            return '<tr class="extra"><td></td><td class="prod">' + esc(x.name) + '</td><td></td>' +
                '<td class="price">' + esc(x.price) + '</td></tr>';
        }).join('');

        return '<section class="dl" data-no="' + esc(o.number || ('ID ' + o.id)) + '">' +
            '<header>' +
                '<div class="shop">' +
                    (LOGO_URL
                        ? '<img class="logo" src="' + esc(LOGO_URL) + '" alt="PRACOVNÍ ODĚVY KOŘÍNEK">'
                        : '<span class="doc">Dodací list</span>') +
                '</div>' +
                headerBox(o) +
                '<div class="ordno">' + esc(o.number || ('ID ' + o.id)) + '</div>' +
            '</header>' +
            warn +
            '<div class="parties">' +
                '<div class="supplier"><div class="lbl">Dodavatel</div>' + DODAVATEL.join('<br>') + '</div>' +
                '<div class="recipient"><div class="lbl">Příjemce' +
                    (o.deliveryAddress ? ' — <b>doručovací adresa</b>' : '') + '</div>' +
                    '<div class="addr">' + o.address.map(esc).join('<br>') + '</div>' +
                    '<div class="contact">' +
                        (o.phone ? 'Tel.: ' + esc(o.phone) + '<br>' : '') +
                        (o.email ? 'E-mail: ' + esc(o.email) : '') +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="meta">' +
                '<span>Objednáno: <b>' + esc(o.created || '—') + '</b></span>' +
                (o.payment ? '<span>Platba: <b>' + esc(o.payment) + '</b></span>' : '') +
                '<span>Vystavil(a): <b>' + esc(info.printedBy || '—') + '</b></span>' +
                '<span>Vytištěno: <b>' + esc(info.printedAt) + '</b></span>' +
            '</div>' +
            '<table class="items">' +
                '<thead><tr><th></th><th>Položka</th><th>Množství</th><th>Cena</th></tr></thead>' +
                '<tbody>' + rows + extras + '</tbody>' +
            '</table>' +
            '<div class="total">K zaplacení: <b>' + esc(o.total) + '</b></div>' +
            '</section>';
    }

    var CSS = [
        '@page { size: A4; margin: 10mm; }',
        '* { box-sizing: border-box; }',
        'html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
        'body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; }',
        // stránky skládá skript sám (kvůli patičce Strana 1/2 u každé objednávky zvlášť)
        '.page { width: 190mm; height: 276mm; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; break-after: page; }',
        '.page:last-child { page-break-after: auto; break-after: auto; }',
        '.page-body { flex: 1 1 auto; overflow: hidden; }',
        '.page-foot { flex: 0 0 6mm; display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; font-size: 8pt; color: #888; border-top: 1px solid #ccc; }',
        '.page-foot span:nth-child(2) { text-align: center; }',
        '.page-foot span:nth-child(3) { text-align: right; }',
        'header { display: flex; justify-content: space-between; align-items: center; gap: 4mm; padding-bottom: 3mm; border-bottom: 2px solid #000; }',
        '.shop { flex: 1; display: flex; flex-direction: column; justify-content: center; }',
        '.shop .logo { display: block; height: 18mm; max-width: 50mm; object-fit: contain; object-position: left center; font-size: 9pt; font-weight: bold; }',
        '.shop .doc { font-size: 15pt; font-weight: bold; }',
        '.ordno { flex: 1; text-align: right; font-size: 18pt; font-weight: bold; }',
        '.carrier { flex: 1.2; height: 18mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; border: 2px solid #000; border-radius: 2mm; padding: 0 3mm; overflow: hidden; }',
        '.carrier-name { display: block; font-weight: bold; line-height: 1.1; }',
        '.paystate { display: block; font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-top: 0.5mm; }',
        '.parties { display: flex; gap: 6mm; margin-top: 3mm; }',
        '.supplier { flex: 1; font-size: 9pt; line-height: 1.35; border: 1px solid #999; border-radius: 2mm; padding: 2.5mm; }',
        '.recipient { flex: 1.2; border: 2px solid #000; border-radius: 2mm; padding: 2.5mm; }',
        '.lbl { font-size: 7pt; color: #444; margin-bottom: 1mm; }',
        '.addr { font-size: 10.5pt; font-weight: bold; line-height: 1.35; }',
        '.contact { font-size: 9pt; margin-top: 1.5mm; }',
        '.meta { display: flex; justify-content: space-between; gap: 4mm; flex-wrap: wrap; font-size: 8.5pt; margin: 3mm 0; }',
        'table.items { width: 100%; border-collapse: collapse; }',
        'table.items th { text-align: left; font-size: 7.5pt; border-bottom: 1px solid #000; padding: 1mm; }',
        'table.items td { border-bottom: 1px solid #ccc; padding: 1.5mm 1mm; vertical-align: top; }',
        'tr.item { page-break-inside: avoid; break-inside: avoid; }',
        'table.items tbody tr:last-child td { border-bottom: 0; }',
        'td.img { width: ' + (VELIKOST_NAHLEDU_MM + 2) + 'mm; }',
        'td.img img { width: ' + VELIKOST_NAHLEDU_MM + 'mm; height: ' + VELIKOST_NAHLEDU_MM + 'mm; object-fit: contain; display: block; }',
        'table.items td.prod { padding-right: 6mm; }',
        '.name { font-size: 12pt; font-weight: bold; line-height: 1.25; }',
        '.var { font-size: 11pt; margin-top: 0.5mm; }',
        '.code { font-size: 11pt; margin-top: 0.5mm; }',
        'td.qty { font-size: 14pt; font-weight: bold; white-space: nowrap; width: 22mm; }',
        'td.qty.multi span { display: inline-block; border: 2.5px solid #000; border-radius: 999px; padding: 0.5mm 2.5mm; margin: -1.2mm 0 0 -2.8mm; }',
        '.warn { border: 2px solid #000; padding: 2mm 3mm; margin-top: 3mm; font-size: 11pt; font-weight: bold; }',
        'td.price { font-size: 9pt; white-space: nowrap; text-align: right; width: 24mm; }',
        'tr.extra td { font-size: 9pt; border-bottom: 0; padding-top: 0.8mm; padding-bottom: 0.8mm; }',
        '.total { text-align: right; font-size: 14pt; margin-top: 3mm; }'
    ].join('\n');

    function buildHtml(orders, info) {
        return '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8">' +
            '<base href="' + esc(location.origin + '/') + '">' +
            '<title>Dodací list</title><style>' + CSS + '</style></head><body>' +
            orders.map(function (o) { return renderOrder(o, info); }).join('') +
            '</body></html>';
    }

    // Rozdělí každou objednávku na stránky A4 a na každou stránku dá patičku
    // „Objednávka … / Strana 1/2“ (číslováno pro každou objednávku zvlášť).
    function paginate(doc) {
        function overflows(body) { return body.scrollHeight > body.clientHeight + 1; }

        Array.prototype.slice.call(doc.querySelectorAll('section.dl')).forEach(function (sec) {
            var no = sec.getAttribute('data-no') || '';
            var pages = [], body, tbody;
            var srcTable = sec.querySelector('table.items');

            function startPage() {
                var page = doc.createElement('div');
                page.className = 'page';
                body = doc.createElement('div');
                body.className = 'page-body';
                var foot = doc.createElement('div');
                foot.className = 'page-foot';
                page.appendChild(body);
                page.appendChild(foot);
                sec.parentNode.insertBefore(page, sec);
                pages.push(page);
                tbody = null;
            }
            function ensureTable() {
                if (tbody) return;
                var t = srcTable.cloneNode(false);
                if (pages.length === 1) t.appendChild(srcTable.querySelector('thead').cloneNode(true));
                tbody = doc.createElement('tbody');
                t.appendChild(tbody);
                body.appendChild(t);
            }
            // přidá prvek; když se nevejde a stránka už něco obsahuje, dá ho na novou stránku
            function place(el, intoTable) {
                if (intoTable) { ensureTable(); tbody.appendChild(el); } else { body.appendChild(el); }
                if (!overflows(body)) return;
                var alone = intoTable ? (tbody.children.length === 1 && body.children.length === 1)
                                      : body.children.length === 1;
                if (alone) return;
                el.parentNode.removeChild(el);
                if (tbody && !tbody.children.length) { tbody.parentNode.remove(); tbody = null; }
                startPage();
                if (intoTable) { ensureTable(); tbody.appendChild(el); } else { body.appendChild(el); }
            }

            startPage();
            Array.prototype.slice.call(sec.children).forEach(function (child) {
                if (child === srcTable) {
                    Array.prototype.slice.call(srcTable.querySelectorAll('tbody > tr')).forEach(function (tr) {
                        place(tr, true);
                    });
                    tbody = null;
                } else {
                    place(child, false);
                }
            });
            sec.remove();

            pages.forEach(function (pg, i) {
                var foot = pg.querySelector('.page-foot');
                foot.innerHTML = '<span></span><span>www.pokorinek.cz</span><span></span>';
                foot.firstChild.textContent = 'Objednávka ' + no;
                foot.lastChild.textContent = 'Strana ' + (i + 1) + '/' + pages.length;
            });
        });
    }

    function printOrders(orders) {
        var now = new Date();
        var info = {
            printedAt: now.getDate() + '. ' + (now.getMonth() + 1) + '. ' + now.getFullYear() + ' ' +
                now.getHours() + ':' + ('0' + now.getMinutes()).slice(-2),
            printedBy: printerName()
        };
        var html = buildHtml(orders, info);
        recordPrint(orders);

        var old = document.getElementById('kdl-frame');
        if (old) old.remove();
        var frame = document.createElement('iframe');
        frame.id = 'kdl-frame';
        // rám musí mít šířku A4, aby šlo změřit, co se vejde na stránku
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;visibility:hidden;';
        document.body.appendChild(frame);

        var fdoc = frame.contentDocument;
        fdoc.open();
        fdoc.write(html);
        fdoc.close();

        var imgs = Array.prototype.slice.call(fdoc.images);
        var waits = imgs.map(function (img) {
            return img.complete ? Promise.resolve() : new Promise(function (res) {
                img.onload = img.onerror = res;
            });
        });
        var timeout = new Promise(function (res) { setTimeout(res, 8000); });
        Promise.race([Promise.all(waits), timeout]).then(function () {
            paginate(fdoc);
            frame.contentWindow.focus();
            frame.contentWindow.print();
        });
    }

    // ------------------------------------------------------------------
    // Zjištění, které objednávky tisknout
    // ------------------------------------------------------------------
    function idFromHref(href) {
        var m = /[?&]id=(\d+)/.exec(href || '');
        return m ? m[1] : null;
    }

    function isDetailPage() {
        return /\/admin\/objednavky-detail\//.test(location.pathname) && idFromHref(location.search);
    }

    function isListPage() {
        return !!document.querySelector('table a[href*="objednavky-detail"]');
    }

    function jobsFromList() {
        var jobs = [], seen = {};
        document.querySelectorAll('table input[type="checkbox"]:checked').forEach(function (cb) {
            var tr = cb.closest('tr');
            if (!tr || tr.closest('thead')) return;
            var link = tr.querySelector('a[href*="objednavky-detail"]');
            var id = link ? idFromHref(link.getAttribute('href')) : null;
            if (!id && /^\d+$/.test(cb.value)) id = cb.value;
            if (!id || seen[id]) return;
            seen[id] = true;
            jobs.push({ id: id, created: findCreatedDate(tr.textContent, true) });
        });
        return jobs;
    }

    function jobsFromDetail() {
        var main = document.querySelector('main, #content, .content, .main') || document.body;
        return [{ id: idFromHref(location.search), created: findCreatedDate(main.innerText || main.textContent, true) }];
    }

    // ------------------------------------------------------------------
    // Tlačítko a jméno tiskaře
    // ------------------------------------------------------------------
    var btn;
    var LABEL = '🖨 Dodací listy';

    // Plynulá změna nápisu: tlačítko se roztáhne / zúží na novou šířku
    // a text se mezitím krátce prolne (žádné skákání)
    function morphLabel(b, html) {
        if (!b.isConnected || !b.innerHTML || b.innerHTML === html) { b.innerHTML = html; return; }
        // šířka bez vlivu zvětšení při najetí myší (transform), jinak by na konci poskočila
        var w = function () { return parseFloat(getComputedStyle(b).width); };
        var from = w();
        b.style.transition = 'none';
        b.style.width = '';
        b.innerHTML = html;
        var to = w();
        b.style.width = from + 'px';
        void b.offsetWidth;   // potvrdit výchozí šířku
        b.style.transition = BTN_TRANSITION;
        b.style.width = to + 'px';
        var inner = b.children;
        for (var i = 0; i < inner.length; i++) {
            inner[i].animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
        }
        clearTimeout(b._morphT);
        b._morphT = setTimeout(function () { b.style.width = ''; }, 320);
    }

    function setBtn(label, busy) {
        delete btn.dataset.loading;
        if (label === LABEL) {
            // ikonka tiskárny a text s mezerou mezi nimi
            morphLabel(btn, '<span aria-hidden="true">🖨</span><span>Dodací listy</span>');
        } else {
            morphLabel(btn, '<span>' + esc(label) + '</span>');
        }
        btn.disabled = !!busy;
        btn.style.opacity = busy ? '0.7' : '1';
        btn.style.cursor = busy ? 'progress' : 'pointer';
        if (btn._rest) btn._rest();
    }

    // Průběh načítání: tlačítko se na „Načítám …“ přepne jen jednou, pak se mění
    // už jen číslo uvnitř (bez prolínání), a číslo má pevnou šířku → nic neproblikává
    function setProgress(done, total) {
        var cnt = btn.querySelector('.kdl-cnt');
        var text = done + '/' + total;
        if (cnt && btn.dataset.loading === String(total)) {
            cnt.textContent = text;
            return;
        }
        var w = String(total).length * 2 + 1;   // např. „50/50“ = 5 znaků
        btn.dataset.loading = String(total);
        morphLabel(btn, '<span>Načítám <span class="kdl-cnt" style="display:inline-block;min-width:' + w + 'ch;' +
            'text-align:center;font-variant-numeric:tabular-nums;">' + text + '</span>…</span>');
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btn.style.cursor = 'progress';
        if (btn._rest) btn._rest();
    }

    function adminName() {
        return txt(document.querySelector(ADMIN_NAME_SEL));
    }
    function printerName() {
        return adminName() || lsGet(LS_NAME);
    }

    function askName() {
        var n = window.prompt('Kdo tiskne? Jméno se bude tisknout na dodací list (v tomto prohlížeči se zapamatuje).', lsGet(LS_NAME));
        if (n !== null) lsSet(LS_NAME, n.trim());
        return n !== null;
    }

    // ------------------------------------------------------------------
    // Zvuky (vytváří je prohlížeč, žádné soubory)
    //   'pop'  = Pop a třpyt   → tlačítko Dodací listy
    //   'tada' = Tú-dú         → tlačítko Štítky
    //   'klik' = Tichý klik    → ikonka v horní liště
    //   'bwomp' = Bwomp        → zamítnutí (nic není zaškrtnuté, slzy)
    // ------------------------------------------------------------------
    var ZVUK = true;               // false = bez zvuku (výchozí stav přepínače)
    var HLASITOST = 0.5;           // 0 až 1
    var audioCtx = null;

    function playSound(kind) {
        if (!getSet('zapnuto') || !getSet('zvuk')) return;
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            var c = audioCtx, t = c.currentTime + 0.02;
            var out = c.createGain();
            out.gain.value = HLASITOST * 0.6;
            out.connect(c.destination);

            var tone = function (type, f0, f1, start, dur, peak) {
                var o = c.createOscillator(), g = c.createGain();
                o.type = type;
                o.frequency.setValueAtTime(f0, start);
                if (f1) o.frequency.exponentialRampToValueAtTime(f1, start + dur * 0.6);
                g.gain.setValueAtTime(0.0001, start);
                g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
                g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
                o.connect(g); g.connect(out);
                o.start(start); o.stop(start + dur + 0.02);
            };
            var whoosh = function (start, dur, fFrom, fTo, peak) {
                var n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
                for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
                var src = c.createBufferSource(); src.buffer = buf;
                var f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
                f.frequency.setValueAtTime(fFrom, start);
                f.frequency.exponentialRampToValueAtTime(fTo, start + dur);
                var g = c.createGain();
                g.gain.setValueAtTime(0.0001, start);
                g.gain.exponentialRampToValueAtTime(peak, start + dur * 0.4);
                g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
                src.connect(f); f.connect(g); g.connect(out);
                src.start(start); src.stop(start + dur);
            };

            if (kind === 'tada') {
                whoosh(t, 0.32, 400, 4000, 0.5);
                [523.25, 659.25, 783.99].forEach(function (f, i) { tone('triangle', f, 0, t + 0.22 + i * 0.07, 0.25, 0.35); });
                tone('sine', 1046.5, 0, t + 0.43, 0.6, 0.4);
                tone('triangle', 1569.75, 0, t + 0.43, 0.4, 0.08);
            } else if (kind === 'bwomp') {
                // měkké padající žuchnutí (zamítnutí)
                var bw = function (type, f0, f1, dur, peak) {
                    var o = c.createOscillator(), g = c.createGain();
                    o.type = type;
                    o.frequency.setValueAtTime(f0, t);
                    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.85);
                    g.gain.setValueAtTime(0.0001, t);
                    g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
                    g.gain.setValueAtTime(peak, t + dur * 0.6);
                    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
                    o.connect(g); g.connect(out);
                    o.start(t); o.stop(t + dur + 0.02);
                };
                bw('sine', 300, 90, 0.35, 0.8);
                bw('triangle', 150, 60, 0.3, 0.25);
            } else if (kind === 'klik') {
                tone('sine', 1200, 600, t, 0.06, 0.6);
                tone('sine', 1800, 0, t + 0.035, 0.08, 0.15);
            } else {   // 'pop'
                tone('sine', 280, 900, t, 0.12, 0.9);
                [1568, 2093, 2637, 3136].forEach(function (f, i) { tone('triangle', f, 0, t + 0.07 + i * 0.045, 0.35, 0.18); });
            }
        } catch (e) { /* zvuk není podstatný */ }
    }

    // ------------------------------------------------------------------
    // Slzy: když nejsou zaškrtnuté objednávky, z tlačítka vystřelí brečící emoji
    // a pak pomalu stékají rovně dolů a mizí
    // ------------------------------------------------------------------
    var SLZY = ['😢', '😭', '😿', '🥲', '😥'];

    function tears(el) {
        if (!getSet('zapnuto') || !getSet('konfety')) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var r = el.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var count = 14;
        for (var i = 0; i < count; i++) {
            var e = document.createElement('div');
            e.textContent = SLZY[Math.floor(Math.random() * SLZY.length)];
            var size = 22 + Math.random() * 14;
            e.style.cssText = 'position:fixed;left:' + (cx - size / 2) + 'px;top:' + (cy - size / 2) + 'px;' +
                'font-size:' + size + 'px;line-height:1;pointer-events:none;z-index:100000;will-change:transform,opacity;';
            document.body.appendChild(e);

            // výstřel doleva nahoru (tlačítko je vpravo dole)
            var angle = Math.PI * (0.95 + Math.random() * 0.6);
            var dist = 90 + Math.random() * 260;
            var dx = Math.cos(angle) * dist;
            var dy = Math.sin(angle) * dist - 60 - Math.random() * 120;
            var fall = 140 + Math.random() * 180;          // jak daleko steče dolů
            var dur = 3200 + Math.random() * 1200;
            var rot = (Math.random() - 0.5) * 30;

            var anim = e.animate([
                { transform: 'translate(0,0) scale(.4)', opacity: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
                { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1) rotate(' + rot + 'deg)', opacity: 1, offset: 0.14, easing: 'linear' },
                { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1) rotate(' + rot + 'deg)', opacity: 1, offset: 0.24, easing: 'cubic-bezier(.45,0,.55,1)' },
                // stékání: jen svisle dolů, vodorovná poloha se už nemění
                { transform: 'translate(' + dx + 'px,' + (dy + fall) + 'px) scale(.95) rotate(' + rot + 'deg)', opacity: 0 }
            ], { duration: dur, fill: 'forwards' });
            anim.onfinish = (function (node) { return function () { node.remove(); }; })(e);
        }
    }

    // ------------------------------------------------------------------
    // Efekt: z tlačítka se rozletí konfety
    // ------------------------------------------------------------------
    var EFEKT_KONFETY = true;   // false = bez konfet

    // smer: 'roh' = tlačítko vpravo dole (letí doleva nahoru), 'shora' = ikonka v liště (rozprsk dolů)
    function confetti(el, smer) {
        if (!getSet('zapnuto') || !getSet('konfety')) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        var r = el.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var dpr = window.devicePixelRatio || 1;
        var canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:100000;';
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        document.body.appendChild(canvas);
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var colors = ['#1a5aa6', '#f5c400', '#e63946', '#2a9d8f', '#ff7f11', '#8338ec', '#ffffff'];
        var parts = [];
        for (var i = 0; i < 450; i++) {
            var angle, speed;
            if (smer === 'shora') {
                // ikonka nahoře v liště: konfety se rozprsknou do stran a dolů
                angle = Math.PI * (-0.15 + Math.random() * 1.3);
                speed = 4 + Math.random() * 18;
            } else {
                // tlačítko je v pravém dolním rohu, konfety letí hlavně doleva a nahoru
                angle = Math.PI * (0.8 + Math.random() * 0.95);
                speed = 5 + Math.random() * 26;
            }
            parts.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - (smer === 'shora' ? 2 : 6),
                w: 5 + Math.random() * 6,
                h: 3 + Math.random() * 5,
                rot: Math.random() * Math.PI,
                vr: (Math.random() - 0.5) * 0.4,
                color: colors[i % colors.length],
                round: Math.random() < 0.3
            });
        }
        var start = performance.now();
        (function frame(now) {
            var t = now - start;
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            var alpha = t < 2400 ? 1 : Math.max(0, 1 - (t - 2400) / 800);
            parts.forEach(function (p) {
                p.vy += 0.28;        // gravitace
                p.vx *= 0.98;        // odpor vzduchu
                p.vy *= 0.98;
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.vr;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                ctx.strokeStyle = 'rgba(0,0,0,0.15)';
                if (p.round) {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.h / 1.5, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    // „mávání“ konfety
                    var sy = Math.abs(Math.cos(p.rot * 2));
                    ctx.fillRect(-p.w / 2, -p.h * sy / 2, p.w, p.h * sy + 0.5);
                }
                ctx.restore();
            });
            if (t < 3200) requestAnimationFrame(frame);
            else canvas.remove();
        })(start);
    }

    function onClick() {
        if (!printerName() && !askName()) return;
        var jobs = isDetailPage() ? jobsFromDetail() : jobsFromList();
        if (!jobs.length) {
            setBtn('Nejdřív zaškrtněte objednávky', false);
            tears(btn);
            playSound('bwomp');
            clearTimeout(btn._msgT);   // opakované kliknutí: hláška zůstane celé 2,5 s od posledního
            btn._msgT = setTimeout(function () { setBtn(LABEL, false); }, 2500);
            return;
        }
        confetti(btn);
        playSound('pop');
        clearTimeout(btn._msgT);
        setProgress(0, jobs.length);
        loadAll(jobs, function (d, n) { setProgress(d, n); })
            .then(function (orders) {
                var bad = orders.filter(function (o) { return o.error || !o.items.length; });
                if (bad.length) {
                    var list = bad.map(function (o) {
                        return '• ' + (o.number || 'ID ' + o.id) + (o.error ? ' (nepodařilo se načíst)' : ' (žádné položky)');
                    }).join('\n');
                    if (!window.confirm('U ' + bad.length + ' z ' + orders.length + ' objednávek je problém:\n\n' +
                            list + '\n\nNa listu bude upozornění. Přesto tisknout?')) {
                        setBtn(LABEL, false);
                        return;
                    }
                }
                printOrders(orders);
                setBtn(LABEL, false);
            });
    }

    var BTN_TRANSITION = 'transform .12s ease-out, box-shadow .12s ease-out, background-color .08s ease-out, width .3s ease, opacity .2s ease';

    // tlačítko s efektem zvětšení při najetí myší a promáčknutí při stisku
    function makeButton(colors, onClickFn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:6px;cursor:pointer;' +
            'font:bold 14px Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);' +
            'background:' + colors.bg + ';color:' + colors.fg + ';border:' + (colors.border || '0') + ';' +
            'white-space:nowrap;overflow:hidden;justify-content:center;transition:' + BTN_TRANSITION + ';';
        b.addEventListener('click', onClickFn);
        var hovered = false;
        function rest() {
            var up = hovered && !b.disabled;
            b.style.transform = up ? 'scale(1.06)' : '';
            b.style.boxShadow = up ? '0 4px 12px rgba(0,0,0,.35)' : '0 2px 8px rgba(0,0,0,.3)';
            b.style.backgroundColor = colors.bg;
        }
        function press() {
            if (b.disabled) return;
            b.style.transform = 'translateY(2px) scale(0.95)';
            b.style.boxShadow = '0 1px 2px rgba(0,0,0,.35)';
            b.style.backgroundColor = colors.bgPressed;
        }
        b.addEventListener('pointerenter', function () { hovered = true; rest(); });
        b.addEventListener('pointerleave', function () { hovered = false; rest(); });
        b.addEventListener('pointerdown', press);
        b.addEventListener('pointerup', rest);
        b.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') press(); });
        b.addEventListener('keyup', rest);
        b._rest = rest;   // po změně stavu (načítání) přepočítat vzhled
        return b;
    }

    function addButton() {
        if (!getSet('zapnuto')) return;
        if (document.getElementById('kdl-box')) { addLabelsButton(); return; }
        if (!isDetailPage() && !isListPage()) return;

        var box = document.createElement('div');
        box.id = 'kdl-box';
        box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99999;display:flex;align-items:center;gap:10px;font:12px Arial,sans-serif;';

        btn = makeButton({ bg: '#1a5aa6', bgPressed: '#154a8a', fg: '#fff' }, onClick);
        box.appendChild(btn);
        document.body.appendChild(box);
        setBtn(LABEL, false);
        addLabelsButton();
    }

    // ------------------------------------------------------------------
    // Tlačítko „Štítky“: klikne za vás na Zásilky → Tisknout štítky (Balíky)
    // ------------------------------------------------------------------
    var STITKY_SEL = '[data-custom-action="openCreateAndPrintShipmentsModal"]';
    var STITKY_LABEL = '<span aria-hidden="true">🏷️</span><span>Štítky</span>';

    function addLabelsButton() {
        var box = document.getElementById('kdl-box');
        if (!box || document.getElementById('kdl-labels')) return;
        if (!document.querySelector(STITKY_SEL)) return;   // jen tam, kde Shoptet tisk štítků nabízí

        var lb = makeButton({ bg: '#1a5aa6', bgPressed: '#154a8a', fg: '#fff' }, function () {
            var link = document.querySelector(STITKY_SEL);
            var info = function (t) {
                morphLabel(lb, '<span>' + esc(t) + '</span>');
                clearTimeout(lb._msgT);
                lb._msgT = setTimeout(function () { morphLabel(lb, STITKY_LABEL); }, 2500);
            };
            if (!link) { info('Štítky tu nejsou k dispozici'); return; }
            if (isListPage() && !jobsFromList().length) { info('Nejdřív zaškrtněte objednávky'); tears(lb); playSound('bwomp'); return; }
            clearTimeout(lb._msgT);
            morphLabel(lb, STITKY_LABEL);
            confetti(lb);
            playSound('tada');
            link.click();
        });
        lb.id = 'kdl-labels';
        lb.title = 'Zásilky → Tisknout štítky (Balíky)';
        lb.innerHTML = STITKY_LABEL;
        box.insertBefore(lb, box.firstChild);
    }

    // ------------------------------------------------------------------
    // Zvýraznění množství víc než 1 ks v administraci
    // (detail objednávky a náhled objednávky při najetí myší v přehledu)
    // ------------------------------------------------------------------
    var ZVYRAZNIT_MNOZSTVI = true;   // false = nezvýrazňovat
    var QTY_TITLE_RE = /^Červené číslo uvádí počet kusů/;
    var QTY_HEADER_RE = /^(mn\.?|množství)$/i;

    function ensureQtyStyle() {
        if (document.getElementById('kdl-qty-style')) return;
        var st = document.createElement('style');
        st.id = 'kdl-qty-style';
        // barvu čísla nechává na Shoptetu (červená = není skladem)
        st.textContent = 'td.kdl-qty-multi { background: #fff3a0 !important; font-weight: bold !important; font-size: 1.35em !important; }';
        document.head.appendChild(st);
    }

    function qtyColumnIndex(table) {
        var head = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
        if (!head) return -1;
        var idx = 0;
        for (var i = 0; i < head.cells.length; i++) {
            var c = head.cells[i];
            if (QTY_HEADER_RE.test(txt(c))) return idx;
            idx += c.colSpan || 1;
        }
        return -1;
    }

    function cellAt(tr, col) {
        var idx = 0;
        for (var i = 0; i < tr.cells.length; i++) {
            if (idx === col) return tr.cells[i];
            idx += tr.cells[i].colSpan || 1;
            if (idx > col) return null;
        }
        return null;
    }

    function markCell(td) {
        if (!td || td.dataset.kdlQty) return;
        td.dataset.kdlQty = '1';
        var q = parseQty(txt(td));
        if (q.num !== null && q.num > 1) td.classList.add('kdl-qty-multi');
    }

    function unhighlightQuantities() {
        document.querySelectorAll('td.kdl-qty-multi').forEach(function (td) { td.classList.remove('kdl-qty-multi'); });
        document.querySelectorAll('td[data-kdl-qty]').forEach(function (td) { delete td.dataset.kdlQty; });
    }

    function highlightQuantities() {
        if (!getSet('zapnuto') || !getSet('zvyrazneni')) return;
        var onDetail = /\/admin\/objednavky-detail\//.test(location.pathname);
        var found = false;

        // náhled objednávky (a případně detail): buňky s nápovědou Shoptetu k množství
        document.querySelectorAll('td[title]').forEach(function (td) {
            if (QTY_TITLE_RE.test(td.getAttribute('title'))) { found = true; ensureQtyStyle(); markCell(td); }
        });

        // detail objednávky: sloupec „Mn.“ v tabulce položek
        if (onDetail) {
            document.querySelectorAll('table').forEach(function (table) {
                var col = qtyColumnIndex(table);
                if (col < 0) return;
                ensureQtyStyle();
                Array.prototype.forEach.call(table.tBodies, function (tb) {
                    Array.prototype.forEach.call(tb.rows, function (tr) { markCell(cellAt(tr, col)); });
                });
            });
        }
        return found;
    }

    // ------------------------------------------------------------------
    // Ikonka v horní liště administrace: je vidět, že skript běží
    // ------------------------------------------------------------------
    var IKONA_V_LISTE = true;          // false = bez ikonky
    var TVAR_IKONY = 'ctverec';        // 'ctverec' (zaoblený čtverec) nebo 'kruh'
    var IKONY = {
        ctverec: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFJklEQVR42u2bW2wUZRTHf983u223XQpUS2+UXaDSGpFqaREkMWAQRBIKCJiIVEq0GryFwIO8CD5INWpqIpBACFCJwQQo1jYQ4wNqhFDkYohAG2gp20Irt9JStred+XygLFvksoWt7O70/zSbmflmzv+c853LzhH0AsMXl2TqHl6WQk00EBkC4oFBPDoo4CoKl5L8JZX4WUZ27a7ZML/Z3wXE/S4YW7Deerkj/g1gqYKnCXqo68B3FqkVVm+eVfdQBAzL2zlFCLEWGEXooU3B566zg1fz62RP7wiYtNficDQVAsv8sZIgxwGLQW711jkX/CLAuWhzlMHAH4Qil7CBOq00prk2vVpz+xl5u+bDT3gAkSZ0sc+5aEfGPQlwOJoKw094LxKVkrvSF5cOuCMBw/J2Tun2+XBGRruuF4MSPQgYW7De2r3bC8Ifs515u/J6EHCpM35hiIa6B9sSBZ8lF5RF33IBxUeYCykRnV0fAsjhi0sygTEmIwBDsQSUkMpgOiaEgFRHfukEiVLPY1IoQ82TCpFuVgKEMCZIIBHTmoBIk0AM5sUgCWgmJkCTmByWvn7A1KwkZo5PRfQyyVYKSg/U8cuRhtAmoKggm5ioB3vM5DEJPPVuWZ++X5+7wIMKDxAdaQl9F7iJ8oPneH/dQb+uXfveOGbkpPwv72X6TbCfgP4w2AcYkWgnfWgs0if2JcXZ/PbrpDib93hGTgqGUlTWt3CmsTXw9YDjzRIVqMXsNgtFb2fzUlZSn2hrz6HzLN94mOvtnuB0gb4UHmB6djJfvTU2OF1gRKLdK/yZxla+/amKji4de7SVYfHRVNa1YBj+GZuUgozUWFwX3bS6u4iK0PhgZgbOhBimZyfjTLBT+09rcBEwKiXWe7ymrIqS/a6HWq+s4r8tnK+7tZ8+NDZgBMjAlVW3Nrz2Tj3g5t/ecWtNixT9YbC/GuyvBvurweCyALfPJjVsSEzAq0Fnot173BrARChgBBypvkxbp44tQmPZnCfJGfUYbT7RICbS/9ZjTLfmhbhBhi1C44XRCV6ij1ZfCT4Cmq938eWO43zy+hgsmuTFzJ7d9idSYpmalcQ37+QQfRcy3B06SzccIi15QI9awBdfbP+bFndXwAjQBj3z2qpALXa0uonTDa04E+wMtkcifeL1qfPXGBht5dmRcXe932qRuDt0oqxaj4LIoytO1jXz6ffH2P6HK7ijQHlFPeUV9d7ftVtmA9BwpY215VVYNIntLhbQ1qGzpqySj+eP9obC4fm7wqMlBlB30c3yjYfNlQjdRHIv+gHJPuYfNgRkpcWRlTbOfC2xmofo4tQ0Xgt9C5i3+neeS3+8119fKaCi6lLoE3C5pYPdf54jmLvCOuaFLoFmExPQKgVUm5iABolgv3nlV5XSMNhhXgLEPukacWw/UG9K/WPskaxaZQjEOhNq/6ireO7xG5mguFoEwmWuL+SMIm8qXLslv10IVppI/hOu2rhtPWqB2i2zilGUmEB4QxgsuTlJ5lMMCRVl0RYBJ8OcgMLarXN+u2M1WLUp95rUtNlAY5h6/s6zbs/Ke5bDZzblVilNTVRwKtyEt8baFrB9vu7X5OjIhSVDPJJSYHyo+zxQeNbtWXm78PefHZ601+JwXlmBEisAWwgKf0IYLPH1+V4PTwOMzP8x1WPoK0AsBOyhkOQoYRS5auO23WtumN6OyaUt2B3rsba/Yig1TSAzQTm4MT7/KP9mb0JxAaFOgtinMPa4iuce9/fmfwGxOrgbA4DKGQAAAABJRU5ErkJggg==',
        kruh: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAHLklEQVR42uWbbVBU1xnHf+feyy7vKllAEGGjBlSMVittp5k4aac6kyaxWaw22soSiNqZ1rxMyYz54pD2U2MSE5N0Jpra3ZjABHUZC01namc6U9tOTTVWIynbFoXFqgHkdUVw2Xv6QV4WAsrLvbKs/0+7e/eee5//ec7znOflCEzGwq2elICQa0DJFUIuBrJBzgExG4jv/5sfZDuINsAroVYgajRdnqg7lN9k5vsJMwadX3g0T5FiM7AWyJ3CcyRQg+APelAvbzz0/VNhS8CiH36cGNB6tgNFwBKTJuxz4DfRqvqu9+D3usKCgIziiiStT3tOwk5gDncHbULIffpN65u+ssfbpokAKTKdlVsFvAokMz1olVL83Lfg7FuUlup3jYCMHx1bpCp9boT4JuGBv+oIZ6PbUTfRG5WJ3pBVcNShqsF/hJHwAA8pyDP2Qs9T5mlAaamSeXHFawL5POEMwesN9nMvjndJjIuA3I0VFn+s5gI2MxMgRZktuqnw9P4dgSkTkLuxwuKPiapEyO8ys/A7m7XZcScSlDtReT1WOzADhQd4rKU32U1p6W1lVG93MdP5lb3ADmYuHpzdnhrXcfaj4xNeApmFno1CUkEEQCC21Lsd5eMmYL6zcqGCPA3MIjLQIVW5yndww4Vx2AApFKm/H0HCA8xSgsIFUtyRgKwCT3GYbXKM8YzwsL2gsuC2SyCjuCJJ7dO8gI3IRJMQIqfe5WgfVQPUQNTzESw8QIou5bOjakB/PF9/F0Pa6UJrtKraB/IJ2sCv/ckMw4VftyqN9d+Yj5hg3CklHPt7I8c/vWL0KyX19AW3Aa8PIwBwmkH33u2riYvWJnXvt5ankvvjKjM2BsUDBCgDOTxgmRkETFZ4gFirZtYyWJpVcGTloAb0JzBNRfUn/+Onv/pkXP995ydf47G8eSZvD5UtwJkBL7COew/fAVAWbvWkAEvvQQJWpG+usim3ihbm1AfCPUaKsgbWaIrCMimNHXnB3HhyMhJRQnxfWlLMuNd1WlLMUFCfNw9dSmovdXLxqt/oDXKuyHJ6yoGnjBguPkZj77bVrF2VZsqU/f7UZUreO831nj6jhvxQAR4wzOebKDzAo6vTefWZrxpZFsvWkNiMsAAL5sYPCn/xqp+3fuulNxAkPjaKzORYahs70fXxrTVFESyen4ivuRt/d4Boi8rO9Yuxp8bx6Op07Knx1H/hNyBClDYNQYIRbGbPSxz8/HaVF8/ffFMar+rkl6frtf7Zz8lINIQAEAlKSIl6SlCVITXquRk0XP17eofG1BTDnFaCwj0ODfADSWY9IAyjwVB0aUi6EOYREJbR4BDNXQqCFjMpDtNocCBd3qIB/wam7Fy7Q4xUZkqc4dGgfe6QrfYbtBGS4NWkFF4hpr4X/rTuGjduBomxqPwsfwl52fdxI8QbxFnV8WtN/8wLcYuMGIvKmmWpg0SfqWs1Sge8mhCcN2KojusB9hypYfeW5WiqwrdXzB12/YF5iaxblcYbO/KIHYOM7t4gL+w/xaL0hGGxQCh+efg8nd0Bg0yAXqPalv/gmi4oMSIiPFPXxn+v+LGnxjMn3ooS4q//c7mLWbFRrFw4tr2N0hS6e4NER6nDAqK+oORfjR28/OE5Dv/FZ5QJ0AMBy06t7lB+U5bTU4NBKbHqk5eoPnlp8Hu9ywHAldYbvFPtRVMVYsbQgBu9Qd6uqmXXpmWDrvD+pyvNMoFnL5c/0TJgZo+blRMMRWNzNyXvnQ6PHZCUfxzMCeq6XqYoygtmPi99AvmA9BD1Ny8lKMqGFUaynJ7PzNCCgSUwuUkybQl83uDOzx1ZGnOb8aQLU8jiXLjaZVal9NdfKo3lFB1L6AkGGzC4OnRfopWv50w85SCBk94WrnX2YmZpbNh72Z2elyXsjujwT8jdDa4Nvxi1OqwHLG8AzREs/heqJbhvzAYJX9njbQh2Rar0UsgXL+zf1HGHHiEpspyVJ4CHIqxD5M8+t+MRGB74KKMtEh3hBDoiSP52VPn0SOHHbJRsdDvqpJTPRI7ho3i0DrHbdor63t9wBHGrhj6zZZevNLjyPUymVbbB5SiRSNcMtnpl9fd/9hKT7xUWMtnash0pPp6B4lfbopsK79Q2P74N2iN/0rIy295FUDRDhP/AZm0uMqRdfoR7fAUoCWulR+6pd+fvGs3iG3JmyF5Y+aSU8mAYttN1SsQ2n9tRYfqhqcyiowuUoHBJeDhcNjlC1wobDq2/OB3H5vYAKUzXsTnESz73kwfGq/KGH5y0F1bO1qV8VsBzmFhiG4FrCPmmagnuG7m3n7ajs8kbK+JjY7Tt/Z4i1yTBzws4eL2770Dz4U3+sD08nVVwZCVC2YJkLYIHJ3M+cSBCB84hOS4UUVbvcvxzRpweD0X65ipblDWwBimWIlmCIBtkEjDi+DztIFpBekHUIvWaQMBy4nL5E6bWLv8PRmF1wl1Kpf4AAAAASUVORK5CYII='
    };

    function scriptVersion() {
        try { return GM_info.script.version; } catch (e) { return ''; }
    }

    function addBadge() {
        if (!IKONA_V_LISTE || document.getElementById('kdl-badge')) return;

        // přesné místo: hned vlevo od čepičky (Shoptet Univerzita)
        var uni = document.querySelector('li.headerNavigation__item--university');
        if (uni && uni.parentNode) {
            insertBadge(uni.parentNode, uni, 'li');
            return;
        }

        // záloha, kdyby Shoptet lištu změnil: první položka lišty
        var userLink = document.querySelector('.headerNavigation__link--user');
        if (!userLink) return;

        // najít položku lišty (např. <li>), ve které je uživatelské menu,
        // tj. předka, jehož rodič obsahuje i další ikonky lišty (čepička, otazník…)
        var item = userLink;
        while (item.parentNode && item.parentNode !== document.body &&
               item.parentNode.querySelectorAll('.headerNavigation__link').length < 2) {
            item = item.parentNode;
        }
        var list = item.parentNode;
        if (!list || list === document.body) return;

        // první položka lišty s odkazem = čepička; ikonku dáme vlevo vedle ní
        var first = null;
        for (var i = 0; i < list.children.length; i++) {
            if (list.children[i].querySelector('.headerNavigation__link')) { first = list.children[i]; break; }
        }
        if (!first) first = item;

        insertBadge(list, first, first.tagName === 'LI' ? 'li' : 'div');
    }

    function insertBadge(list, before, tag) {
        var wrap = document.createElement(tag);
        wrap.id = 'kdl-badge';
        wrap.className = 'headerNavigation__item';
        wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;';

        var img = document.createElement('img');
        img.src = IKONY[TVAR_IKONY] || IKONY.ctverec;
        img.alt = '';
        img.title = NAZEV + ' – klikněte pro informace a nastavení';
        img.style.cssText = 'width:32px;height:32px;display:block;cursor:pointer;margin:0 4px;' +
            'transition:transform .15s ease-out;';
        if (!getSet('zapnuto')) img.style.filter = 'grayscale(1) opacity(.55)';
        // mírné zvětšení při najetí myší
        img.addEventListener('mouseenter', function () { img.style.transform = 'scale(1.15)'; });
        img.addEventListener('mouseleave', function () { img.style.transform = ''; });
        wrap.appendChild(img);

        // kliknutí otevře / zavře info okénko
        img.addEventListener('click', function (e) {
            e.stopPropagation();
            if (infoOpen()) hideInfo(); else { showInfo(img); confetti(img, 'shora'); playSound('klik'); }
        });
        list.insertBefore(wrap, before);
        showPrintSummary();   // po obnovení stránky dobíhá zbytek času
    }

    // ------------------------------------------------------------------
    // Statistika tisku (jen v tomto prohlížeči) a info okénko u ikonky
    // ------------------------------------------------------------------
    var LS_STATS = 'korinekDL.stats';

    function todayKey() {
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    function loadStats() {
        try { return JSON.parse(lsGet(LS_STATS)) || {}; } catch (e) { return {}; }
    }
    // „1 149 Kč“ / „1 149,50 Kč“ → 1149 / 1149.5
    function parseKc(t) {
        var n = parseFloat(String(t || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }
    function formatKc(n) {
        return Math.round(n).toLocaleString('cs-CZ') + ' Kč';
    }

    function recordPrint(orders) {
        var ok = orders.filter(function (o) { return !o.error; });
        var count = ok.length;
        var sum = ok.reduce(function (a, o) { return a + parseKc(o.total); }, 0);
        var st = loadStats();
        if (st.day !== todayKey()) { st.day = todayKey(); st.todayOrders = 0; st.todayPrints = 0; }
        st.todayOrders = (st.todayOrders || 0) + count;
        st.todayPrints = (st.todayPrints || 0) + 1;
        st.lastAt = Date.now();
        st.lastCount = count;
        st.lastSum = sum;
        lsSet(LS_STATS, JSON.stringify(st));
        showPrintSummary();
    }

    // Po tisku se vedle ikonky v liště na 15 s ukáže, kolik objednávek a za kolik se vytisklo
    var SOUHRN_TISKU_MS = 15000;   // jak dlouho je souhrn vidět (ms)
    var summaryTimer = null;

    function showPrintSummary() {
        var wrap = document.getElementById('kdl-badge');
        var st = loadStats();
        if (!wrap || !st.lastAt) return;
        var left = SOUHRN_TISKU_MS - (Date.now() - st.lastAt);
        var el = document.getElementById('kdl-badge-sum');
        if (left <= 0) { if (el) el.remove(); return; }

        // text se „vysune“ plynulým rozšířením šířky, takže ikonka plynule uhne
        // a po skrytí se stejně plynule vrátí na původní místo
        var ANIM = 'width .45s ease, margin-left .45s ease, opacity .35s ease';
        if (!el) {
            el = document.createElement('div');
            el.id = 'kdl-badge-sum';
            el.style.cssText = 'display:flex;flex-direction:column;justify-content:center;line-height:1.25;' +
                'color:#fff;font:12px Arial,sans-serif;white-space:nowrap;overflow:hidden;' +
                'width:0;margin-left:0;opacity:0;transition:' + ANIM + ';';
            wrap.appendChild(el);
        }
        el.innerHTML = '<b style="font-size:13px;">' + st.lastCount + ' ' + ordersWord(st.lastCount) + '</b>' +
            '<span style="color:#aab3bf;">' + (st.lastSum != null ? formatKc(st.lastSum) : '') + '</span>';
        el.title = 'Právě vytištěno';
        el.dataset.closing = '';

        // cílová šířka = šířka obsahu
        var prev = el.style.width;
        el.style.transition = 'none';
        el.style.width = 'auto';
        var target = el.scrollWidth;
        el.style.width = prev;
        void el.offsetWidth;   // potvrdit výchozí stav před animací
        el.style.transition = ANIM;
        requestAnimationFrame(function () {
            el.style.width = target + 'px';
            el.style.marginLeft = '8px';
            el.style.opacity = '1';
        });

        clearTimeout(summaryTimer);
        summaryTimer = setTimeout(function () {
            el.dataset.closing = '1';
            el.style.opacity = '0';
            el.style.width = '0';
            el.style.marginLeft = '0';
            setTimeout(function () { if (el.dataset.closing === '1') el.remove(); }, 500);
        }, left);
    }

    function agoText(ts) {
        var min = Math.round((Date.now() - ts) / 60000);
        if (min < 1) return 'právě teď';
        if (min < 60) return 'před ' + min + ' min';
        var d = new Date(ts);
        var time = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
        if (new Date().toDateString() === d.toDateString()) return 'dnes v ' + time;
        return d.toLocaleDateString('cs-CZ') + ' ' + time;
    }
    function ordersWord(n) {
        return n === 1 ? 'objednávka' : (n >= 2 && n <= 4 ? 'objednávky' : 'objednávek');
    }

    function toggleHtml(key, on) {
        var names = { zapnuto: 'Zapnout nebo vypnout skript', zvyrazneni: 'Zvýraznění 2+ ks', konfety: 'Konfety', zvuk: 'Zvuk' };
        return '<button type="button" data-kdl-toggle="' + key + '" aria-pressed="' + on + '" ' +
            'aria-label="' + esc(names[key] || key) + '" title="' + (on ? 'Vypnout' : 'Zapnout') + '" ' +
            'style="position:relative;width:34px;height:20px;border:0;border-radius:10px;cursor:pointer;padding:0;flex:0 0 auto;' +
            'background:' + (on ? '#3ddc84' : '#4a525e') + ';transition:background .15s;">' +
            '<span style="position:absolute;top:2px;left:' + (on ? '16px' : '2px') + ';width:16px;height:16px;border-radius:50%;' +
            'background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.3);"></span></button>';
    }

    function infoHtml() {
        var v = scriptVersion();
        var on = getSet('zapnuto');
        var st = loadStats();
        var today = st.day === todayKey() ? (st.todayOrders || 0) : 0;
        var rows = [];

        var head = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
                '<div style="flex:1;">' +
                    '<b style="font-size:14px;">' + esc(NAZEV) + '</b>' +
                    '<div style="display:flex;align-items:center;gap:6px;margin-top:3px;color:' + (on ? '#3ddc84' : '#ff8a80') + ';">' +
                        '<span style="width:8px;height:8px;border-radius:50%;background:currentColor;"></span>' +
                        (on ? 'Aktivní' : 'Vypnuto') +
                        (v ? '<span style="color:#9aa4b2;">· verze ' + esc(v) + '</span>' : '') +
                    '</div>' +
                '</div>' +
                toggleHtml('zapnuto', on) +
            '</div>';

        if (!on) {
            return head + '<div style="color:#c3cad4;">Skript je vypnutý: tlačítko pro tisk dodacích listů ani zvýraznění množství se nezobrazují. ' +
                'Zapnete ho přepínačem vpravo nahoře.</div>';
        }

        // co se dá dělat na této stránce
        if (isDetailPage()) {
            rows.push(['Tato stránka', 'detail objednávky — tlačítko vpravo dole vytiskne její dodací list']);
        } else if (isListPage()) {
            var n = jobsFromList().length;
            rows.push(['Vybráno', n ? '<b>' + n + '</b> ' + ordersWord(n) + ' k tisku' : 'nic — zaškrtněte objednávky a tiskněte tlačítkem vpravo dole']);
        } else {
            rows.push(['Tato stránka', 'tisk je dostupný v přehledu objednávek a v detailu objednávky']);
        }
        rows.push(['Dnes vytištěno', '<b>' + today + '</b> ' + ordersWord(today) + ' (na tomto počítači)']);
        if (st.lastAt) rows.push(['Naposledy', agoText(st.lastAt) + ' · ' + st.lastCount + ' ' + ordersWord(st.lastCount) +
            (st.lastSum != null ? ' · ' + formatKc(st.lastSum) : '')]);
        rows.push(['Vystavil(a)', esc(printerName() || '—')]);

        var feat = function (key, label) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">' +
                '<span>' + label + '</span>' + toggleHtml(key, getSet(key)) + '</div>';
        };

        return head +
            '<table style="border-collapse:collapse;width:100%;">' +
            rows.map(function (r) {
                return '<tr><td style="color:#9aa4b2;padding:3px 10px 3px 0;white-space:nowrap;vertical-align:top;">' + r[0] + '</td>' +
                    '<td style="padding:3px 0;">' + r[1] + '</td></tr>';
            }).join('') +
            '</table>' +
            '<div style="margin-top:8px;padding-top:6px;border-top:1px solid #333a44;">' +
                feat('zvyrazneni', 'Zvýraznění 2+ ks v administraci') +
                feat('konfety', 'Konfety') +
                feat('zvuk', 'Zvuk') +
            '</div>' +
            '<div style="margin-top:6px;padding-top:8px;border-top:1px solid #333a44;color:#9aa4b2;">' +
                'Tip: v dialogu tisku nechte Měřítko a Okraje na „Výchozí“.' +
            '</div>';
    }

    // použije nastavení hned, bez obnovení stránky
    function applySettings() {
        var on = getSet('zapnuto');
        var box = document.getElementById('kdl-box');
        if (!on && box) box.remove();
        if (on) addButton();
        unhighlightQuantities();
        highlightQuantities();
        var badgeImg = document.querySelector('#kdl-badge img');
        if (badgeImg) badgeImg.style.filter = on ? '' : 'grayscale(1) opacity(.55)';
    }

    function infoOpen() {
        var box = document.getElementById('kdl-info');
        return !!(box && box.dataset.open === '1');
    }

    function showInfo(anchor) {
        var box = document.getElementById('kdl-info');
        if (!box) {
            box = document.createElement('div');
            box.id = 'kdl-info';
            box.style.cssText = 'position:fixed;z-index:100001;width:300px;background:#1d2229;color:#e8ecf1;' +
                'border-radius:8px;padding:12px 14px;font:12px/1.4 Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);' +
                'opacity:0;transform:translateY(-4px);transition:opacity .12s, transform .12s;visibility:hidden;';
            document.body.appendChild(box);
            box.addEventListener('click', function (e) {
                e.stopPropagation();   // klik uvnitř okénka ho nezavírá
                var t = e.target.closest('[data-kdl-toggle]');
                if (!t) return;
                var key = t.getAttribute('data-kdl-toggle');
                setSet(key, !getSet(key));
                applySettings();
                box.innerHTML = infoHtml();
                if (key !== 'zapnuto' || getSet('zapnuto')) {
                    if (key === 'zvuk' && getSet('zvuk')) playSound('klik');   // ukázka zvuku po zapnutí
                    if (getSet('zapnuto') && getSet('konfety') && (key === 'zapnuto' || key === 'konfety')) {
                        confetti(document.querySelector('#kdl-badge img') || t, 'shora');
                    }
                }
            });
        }
        box.innerHTML = infoHtml();
        var r = anchor.getBoundingClientRect();
        var left = Math.min(Math.max(8, r.left + r.width / 2 - 150), window.innerWidth - 308);
        box.style.left = left + 'px';
        box.style.top = (r.bottom + 10) + 'px';
        box.dataset.open = '1';
        box.style.visibility = 'visible';
        requestAnimationFrame(function () { box.style.opacity = '1'; box.style.transform = 'translateY(0)'; });
    }

    function hideInfo() {
        var box = document.getElementById('kdl-info');
        if (!box) return;
        box.dataset.open = '';
        box.style.opacity = '0';
        box.style.transform = 'translateY(-4px)';
        setTimeout(function () { if (box.dataset.open !== '1') box.style.visibility = 'hidden'; }, 150);
    }

    // zavření info okénka kliknutím mimo něj nebo klávesou Esc (registruje se jen jednou)
    document.addEventListener('click', function (e) {
        var box = document.getElementById('kdl-info');
        if (infoOpen() && box && !box.contains(e.target)) hideInfo();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && infoOpen()) hideInfo(); });

    addButton();
    highlightQuantities();
    addBadge();
    var pending = false;
    new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; addButton(); highlightQuantities(); addBadge(); }, 300);
    }).observe(document.body, { childList: true, subtree: true });

    // pro ladění v konzoli
    window.KorinekDL = {
        parseOrder: parseOrder, buildHtml: buildHtml, paginate: paginate, findCreatedDate: findCreatedDate, storeFromShipping: storeFromShipping, carrierFromShipping: carrierFromShipping
    };
})();
