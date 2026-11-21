import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {Script, runInNewContext} from 'node:vm'
import {createSalonServer} from '../server.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

test('all five standalone views contain valid inline JavaScript', async () => {
  for (const name of ['main', 'auxiliar', 'estilistas', 'manicuristas', 'juan-pablo']) {
    const html = await readFile(path.join(root, 'htmls', name + '.html'), 'utf8')
    assert.equal(html.indexOf('</html>'), html.trimEnd().length - '</html>'.length, name)
    assert.equal(html.split('async function openTickets(').length, 2, name)
    for (const [, source] of html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)) {
      new Script(source, {filename: name + '.html'})
    }
  }
})

async function launch(dataDirectory) {
  const result = await createSalonServer({dataDirectory, seedPath: path.join(root, 'initial-team.json'), publicDirectory: path.join(root, 'htmls')})
  await new Promise((resolve, reject) => {result.server.once('error', reject); result.server.listen(0, '127.0.0.1', resolve)})
  return {...result, url: `http://127.0.0.1:${result.server.address().port}`}
}
const close = server => new Promise(resolve => {
  server.close(resolve)
  server.closeAllConnections?.()
})

test('open tickets display oldest first in every view, even after adding services', async () => {
  const lines = [
    {ticketGroupId: 'new', ticketNumber: 3, ticketStatus: 'open', createdAt: '2026-11-20T10:00:00.000Z'},
    {ticketGroupId: 'old', ticketNumber: 1, ticketStatus: 'open', createdAt: '2026-11-18T10:00:00.000Z'},
    {ticketGroupId: 'middle', ticketNumber: 2, ticketStatus: 'open', createdAt: '2026-11-19T10:00:00.000Z'},
    {ticketGroupId: 'old', ticketNumber: 1, ticketStatus: 'open', createdAt: '2026-11-21T10:00:00.000Z'}
  ]
  for (const name of ['main', 'auxiliar', 'manicuristas', 'estilistas', 'juan-pablo']) {
    const html = await readFile(path.join(root, 'htmls', `${name}.html`), 'utf8')
    const start = html.indexOf('      const groups = new Map();', html.indexOf('const historyScroll ='))
    const end = html.indexOf('      let activeGroup =', start)
    assert.ok(start >= 0 && end > start, `open ticket grouping exists in ${name}`)
    const context = {allTickets: lines, ticketGroupVisible: () => true}
    runInNewContext(html.slice(start, end) + '\nglobalThis.result = openGroups;', context)
    assert.deepEqual(Array.from(context.result, group => group.id), ['old', 'middle', 'new'], name)
    assert.equal(context.result[0].createdAt, '2026-11-18T10:00:00.000Z', name)
  }
})

test('serves the four views with server connectivity enabled', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  for (const route of ['/main', '/auxiliar', '/manicuristas', '/estilistas']) {
    const response = await fetch(url + route)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /connect-src 'self'/)
    assert.match(html, /img-src 'self' data:/)
    assert.match(html, /JOSEPP/)
    assert.match(html, /window\.salonTicketStorage =/)
    assert.match(html, /const localStorage = window\.salonTicketStorage/)
    const queueCard = html.slice(html.indexOf('function qd('), html.indexOf('var Vd=', html.indexOf('function qd(')))
    assert.doesNotMatch(queueCard, /setTimeout|showModal|person-menu|onPointerDown/)
    assert.match(html, /className:"team-visibility"/)
    assert.match(html, /checked:z\.active&&!tB\(z\)/)
    assert.match(html, /data-reopen-ticket/)
    assert.match(html, /¿Reabrir ticket #/)
    assert.match(html, /data-reopen-confirm/)
    assert.match(html, /event\.target\.closest\("button,input,label"\)/)
    assert.match(html, /class="pt-receipt/)
    assert.match(html, /class="pt-receipt-strip"/)
    assert.match(html, /scroll-snap-type:x mandatory/)
    assert.match(html, /class="pt-receipt-customer">\$\{esc\(`/)
    assert.doesNotMatch(html, /class="pt-receipt-brand">Josepp/)
    assert.match(html, /const historyScroll =/)
    assert.match(html, /dateMatch\[3\].*dateMatch\[2\]/)
    assert.match(html, /Requiere insumos/)
    assert.match(html, /const requiresSupplies =/)
    assert.match(html, /selectedTicketSupplies\.get\(name\)/)
    assert.match(html, /const paymentOptions = \[\["cash", "Efectivo", "💵"\], \["credit_card", "Tarjeta de crédito", "💳"\], \["transfer", "Transferencia", "🏦"\]\]/)
    assert.match(html, /aria-label="\$\{label\}"[\s\S]*?<span aria-hidden="true">\$\{icon\}<\/span>/)
    assert.match(html, /class="pt-history-payment" role="radiogroup"/)
    assert.match(html, /data-payment-group="\$\{esc\(group\.id\)\}"/)
    assert.doesNotMatch(html, /name="ticket-payment-method"/)
    assert.doesNotMatch(html, /Selecciona la forma de pago antes de finalizar/)
    assert.match(html, /data-ticket-group="\$\{esc\(group\.id\)\}"/)
    assert.match(html, /class="pt-receipt pt-open-receipt" role="button" tabindex="0" data-open="\$\{esc\(group\.id\)\}" data-ticket-group=/)
    assert.match(html, /\.pt-open-home ul\.pt-receipt-strip/)
    assert.match(html, /\.pt-client\{width:min\(540px,100%\);margin-top:0;transform:none\}/)
    assert.match(html, /#paper-nav-drawer\{[^}]*width:25vw/)
    assert.match(html, /#paper-nav-toggle\{position:fixed;top:50%;left:6px;z-index:1295;width:38px/)
    assert.doesNotMatch(html, /\.queue-board\{padding-left:72px!important\}/)
    assert.match(html, /drawerToggle\.id = "paper-nav-toggle"/)
    assert.match(html, /html\.paper-overlay-open,html\.paper-overlay-open body\{overflow:hidden!important;scrollbar-gutter:auto!important\}/)
    assert.match(html, /function syncPageScrollLock\(\)/)
    assert.match(html, /drawer\.id = "paper-nav-drawer"/)
    assert.match(html, /historyLauncher\.textContent = "Historial de tickets"/)
    assert.match(html, /class="pt-drawer-footer"[\s\S]*?data-drawer-appearance[\s\S]*?data-drawer-fullscreen/)
    assert.match(html, /\.pt-drawer-footer\{display:grid;grid-template-columns:1fr 1fr/)
    assert.match(html, /\.app-controls\{position:relative!important;z-index:1310!important;height:0!important/)
    assert.match(html, /const openSelectedTicket =/)
    assert.match(html, /¿Borrar ticket #/)
    assert.match(html, /data-delete-confirm/)
    assert.match(html, /function showStyledConfirm\(host,/)
    assert.match(html, /showStyledConfirm\(root, \{ title: "¿Eliminar este servicio\?"/)
    assert.doesNotMatch(html, /confirm\("¿Seguro que quieres eliminar este servicio\?"\)/)
    assert.doesNotMatch(html, /confirm\("Hay servicios sin guardar\. ¿Descartarlos\?"\)/)
    assert.match(html, /ticketWorkspace = currentView/)
    assert.match(html, /if \(root\.isConnected\) \{ root\.dataset\.view = currentView; renderTickets\(root\); \}/)
    assert.match(html, /touchstart/)
    assert.match(html, /width:min\(1180px,calc\(100% - 32px\)\)/)
    assert.match(html, /PAPER_SERVICES.*"PRODUCTO"/)
    assert.match(html, /name === "PRODUCTO" \|\| !deleted\.has\(name\)/)
    assert.match(html, /data-product-name/)
    assert.match(html, /productName: selectedProductName\.trim\(\)/)
    assert.match(html, /productName: line\.productName \|\| null/)
    assert.match(html, /data-product-field hidden/)
    assert.match(html, /data-pending-product-name/)
    assert.match(html, /data-pending-product-price/)
    assert.match(html, /aria-label="Eliminar producto"/)
    assert.match(html, /line\.serviceName === "PRODUCTO" \? `<button class="pt-product-delete danger"/)
    assert.match(html, /__serviceOrder/)
    assert.match(html, /button\.setPointerCapture\(capturePointer\)/)
    assert.match(html, /#paper-tickets \.pt-service\{touch-action:pan-y/)
    assert.match(html, /button\.addEventListener\("touchmove"[\s\S]*?\{ passive: false \}\)/)
    assert.match(html, /saveServiceOrder\(names\)/)
    assert.match(html, /names\.splice\(names\.indexOf\(moved\), 1\)/)
    assert.doesNotMatch(html, /target\.(?:before|after)\(button\)/)
    assert.match(html, /suppressServiceClickUntil = Date\.now\(\) \+ 400/)
    assert.match(html, /if \(button\.dataset\.dragged === "true" \|\| Date\.now\(\) < suppressServiceClickUntil \|\| !activeWorker\) return/)
    assert.match(html, /<section class="pt-ticket-actions"><nav class="pt-tabs">/)
    assert.match(html, /data-action="open-list">Tickets abiertos[\s\S]*?<\/nav><button type="button" data-action="save-open">Dejar ticket abierto<\/button><button type="button" class="primary" data-action="finalize">Finalizar/)
    assert.match(html, /historyLauncher\.textContent = "Historial de tickets"/)
    assert.match(html, /#paper-tickets\[data-view="tickets"\] \.pt-history\{display:none\}/)
    assert.match(html, /class="pt-open pt-open-home"/)
    assert.match(html, /workers\.find\(\(worker\) => worker\.code === assigneeCode\) \|\| \[\.\.\.\(group\?\.lines \|\| \[\]\)\]\.reverse\(\)/)
    assert.match(html, /renderTickets\(root\);\s+root\.scrollTop = 0;/)
    if (route !== '/main') assert.match(html, /const pendingGroups = historyGroups\.filter\(\(group\) => isFinalized\(group\) && !group\.lines\.every\(isEntered\)\)/)
    assert.match(html, /const finalizedGroups = historyGroups\.filter\(isFinalized\)/)
    if (route === '/main') {
      assert.match(html, /const historyOpenMarkup = `<details class="pt-history-section" data-history="open"/)
      assert.match(html, /<summary>Tickets abiertos <span>\$\{openGroups\.length\}<\/span><\/summary>\$\{openList\}/)
      assert.match(html, /<summary>Tickets finalizados <span>\$\{finalizedGroups\.length\}<\/span>/)
      assert.match(html, /<h2>Historial de tickets<\/h2>\$\{historyOpenMarkup\}\$\{historyMarkup\}/)
    }
    assert.match(html, /else showFinalizedTickets = section\.open/)
    assert.match(html, /openTickets\("history"\)/)
    assert.match(html, /#paper-tickets \.pt-ticket-actions\{display:grid;grid-template-columns:auto auto minmax\(0,1fr\) auto auto/)
    assert.match(html, /\.app-controls \.undo-button,\.salon-app \.app-controls \.menu,\.salon-app \.app-controls \.appearance>summary,body>\.fullscreen-button\{display:none!important\}/)
    assert.match(html, /\.pt-drawer-nav>button\{position:static!important/)
    assert.match(html, /#paper-undo-toggle\{position:fixed;top:50%;right:6px;z-index:1295;display:grid;place-items:center;width:38px/)
    assert.match(html, /undoToggle\.setAttribute\("aria-label", "Deshacer último cambio"\)/)
    assert.match(html, /undoToggle\.disabled = !source \|\| source\.disabled/)
    assert.match(html, /if \(source && !source\.disabled\) source\.click\(\)/)
    assert.doesNotMatch(html, /pt-drawer-extra/)
    assert.match(html, /drawerNav\.append\(proxy\)/)
    assert.match(html, /function runDrawerMenuAction\(label\)/)
    assert.match(html, /hiddenMenu\?\.style\.setProperty\("display", "block", "important"\)/)
    assert.match(html, /appearanceSource\.open = !appearanceSource\.open/)
    assert.match(html, /const visiblePriceServices = getAllServices\(\)\.filter\(\(name\) => name !== "PRODUCTO"\)/)
    assert.match(html, /const SERVICE_ROLES = \[\["MANICURISTA", "Manicuristas"\], \["ESTILISTA", "Estilistas"\], \["AUXILIAR", "Auxiliar"\]\]/)
    assert.match(html, /class="pt-price-column"/)
    assert.match(html, /type="checkbox" name="\\?\$\{esc\(name\)\}" value="\\?\$\{role\}\"/)
    assert.match(html, /\.pt-price-column\{min-width:0;padding:18px/)
    assert.match(html, /document\.body\.append\(drawerBackdrop, drawer, drawerToggle, undoToggle, ticketFab\)/)
    assert.match(html, /#paper-tickets\{top:0\}/)
    assert.match(html, /__workerOrder/)
    assert.match(html, /saveWorkerOrder\(codes\)/)
    assert.match(html, /#paper-tickets \.pt-worker-choice\.pt-dragging/)
    assert.match(html, /async function openPrices\(\) \{[\s\S]*?document\.querySelector\('#paper-tickets \[data-pt="back"\]'\)\?\.click\(\);[\s\S]*?page\.id = "paper-prices"/)
    assert.ok(html.lastIndexOf('#paper-tickets{top:0}') > html.lastIndexOf('#paper-tickets,#paper-prices{top:58px}'))
  }
  const manicuristas = await (await fetch(url + '/manicuristas')).text()
  const estilistas = await (await fetch(url + '/estilistas')).text()
  assert.match(manicuristas, /available-panel:nth-child\(2\)/)
  assert.match(estilistas, /available-panel:nth-child\(1\)/)
  const watermark = await fetch(url + '/josepp-watermark.png')
  assert.equal(watermark.status, 200)
  assert.match(watermark.headers.get('content-type'), /image\/png/)
  assert.deepEqual([...new Uint8Array(await watermark.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
})

test('serves Juan Pablo phone view with personal tickets and bottom navigation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-personal-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  for (const route of ['/juan-pablo', '/juan-pablo.html']) {
    const response = await fetch(url + route)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /const PERSONAL_WORKER_ID = "e69d26e7-d3d7-440e-9117-c71e264a1d70"/)
    assert.match(html, /bottomNav\.append\(launcher, historyLauncher, drawerToggle\)/)
    assert.match(html, /group\.lines\.some\(\(line\) => String\(line\.workerCode/)
    assert.match(html, /if \(PERSONAL_WORKER_ID\) activeWorker = workers\[0\] \|\| null/)
    assert.match(html, /function chooseOpenTicketWorker\(root, selectedCode, onSelect\) \{\s+if \(root\.querySelector\("\[data-open-worker-modal\]"\)\) return;\s+const workers = getWorkers\(true\)/)
    assert.match(html, /¿Para quién queda abierto\?/)
    assert.match(html, /if \(PERSONAL_WORKER_ID \|\| new URLSearchParams/)
    assert.match(html, /#juan-nav\{position:fixed;left:0;right:0;bottom:0/)
  }
})

test('Tickets tab asks for a customer name only for a blank new ticket', async () => {
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas', 'juan-pablo']) {
    const html = await readFile(path.join(root, 'htmls', `${view}.html`), 'utf8')
    const start = html.indexOf('    const showTickets = () => {')
    const end = html.indexOf('    launcher.addEventListener("click", showTickets);', start)
    assert.ok(start > 0 && end > start, view)
    const pageRoot = {dataset: {}}
    const prompts = []
    const opens = []
    const context = {
      navigationVersion: 0, ticketWorkspace: 'history', openTicketId: '', ticketClientName: '',
      document: {querySelector: () => pageRoot},
      renderTickets: () => {}, requestTicketCustomer: target => prompts.push(target),
      openTickets: (...args) => opens.push(args)
    }
    runInNewContext(html.slice(start, end) + '\nglobalThis.clickTickets = showTickets;', context)
    context.clickTickets()
    assert.equal(prompts.length, 1, view)
    assert.equal(prompts[0], pageRoot, view)
    context.ticketClientName = 'Ana'
    context.clickTickets()
    assert.equal(prompts.length, 1, view)
    context.ticketClientName = ''
    context.openTicketId = 'open-group'
    context.clickTickets()
    assert.equal(prompts.length, 1, view)
    context.openTicketId = ''
    context.document.querySelector = () => null
    context.clickTickets()
    assert.deepEqual(Array.from(opens[0]), ['tickets', true], view)
  }
})

test('finalized history groups tickets by their closing date', async () => {
  const today = new Date('2026-11-20T05:00:00Z')
  const yesterday = new Date(today.getTime() - 1)
  const dateKey = date => date === today ? '2026-11-20' : '2026-11-19'
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas', 'juan-pablo']) {
    const html = await readFile(path.join(root, 'htmls', `${view}.html`), 'utf8')
    const start = html.indexOf('      const finalizedGroups = historyGroups.filter(isFinalized);')
    const end = html.indexOf('      const workerColumns =', start)
    assert.ok(start > 0 && end > start, view)
    const context = {
      historyGroups: [
        {id: 'closed-today', lines: [{ticketStatus: 'finalized', closedAt: today.toISOString(), localDate: dateKey(yesterday)}]},
        {id: 'closed-yesterday', lines: [{ticketStatus: 'finalized', closedAt: yesterday.toISOString(), localDate: dateKey(today)}]},
        {id: 'still-open', lines: [{ticketStatus: 'open', localDate: dateKey(today)}]}
      ],
      isFinalized: group => group.lines.every(line => line.ticketStatus !== 'open'),
      root: {dataset: {}},
      Date: class extends Date {constructor(...args) {super(...(args.length ? args : [today.getTime()]))}},
      historyList: groups => groups.map(group => group.id).join(','),
      showFinalizedTickets: true, TICKET_WORKER_SPECIALTY: true
    }
    const calendar = html.slice(html.indexOf('    const salonCalendar ='), html.indexOf('    const ticketId ='))
    runInNewContext(calendar + html.slice(start, end) + '\nglobalThis.todayGroups = finalizedTodayGroups; globalThis.olderGroups = finalizedOlderGroups; globalThis.markup = historyMarkup;', context)
    assert.deepEqual(Array.from(context.todayGroups, group => group.id), ['closed-today'], view)
    assert.deepEqual(Array.from(context.olderGroups, group => group.id), ['closed-yesterday'], view)
    assert.match(context.markup, /Hoy/)
  }
})

test('broadcasts each saved ticket activity to connected tablets', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-activity-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  const controller = new AbortController()
  t.after(() => controller.abort())
  const events = await fetch(url + '/events', {signal: controller.signal})
  assert.equal(events.status, 200)
  const reader = events.body.getReader()
  const ticket = {id: 'line-1', ticketGroupId: 'group-1', ticketStatus: 'open', workerName: 'Ana', serviceName: 'CORTE DAMA', customerName: 'Cliente', amount: 20000}
  const body = {action: 'changes', upsert: [ticket], deleteIds: [], settings: {}, activity: {status: 'open', workerName: 'Ana', groupId: 'group-1'}}
  const response = await fetch(url + '/ticket-state', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})
  assert.equal(response.status, 200)
  let stream = ''
  let cursor = 0
  const nextActivity = async () => {
    for (;;) {
      const start = stream.indexOf('event: ticket-activity\ndata: ', cursor)
      const end = start < 0 ? -1 : stream.indexOf('\n\n', start)
      if (end >= 0) {
        cursor = end + 2
        return JSON.parse(stream.slice(start + 'event: ticket-activity\ndata: '.length, end))
      }
      const chunk = await reader.read()
      assert.equal(chunk.done, false)
      stream += new TextDecoder().decode(chunk.value)
    }
  }
  const opened = await nextActivity()
  assert.equal(opened.status, 'open')
  assert.equal(opened.workerName, 'Ana')
  assert.equal(opened.ticket, undefined)
  const finalized = {...ticket, ticketStatus: 'finalized', closedAt: '2026-11-20T15:00:00.000Z'}
  const extra = {...finalized, id: 'line-2', serviceName: 'CEPILLADO', amount: 15000}
  const finalResponse = await fetch(url + '/ticket-state', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...body, upsert: [finalized, extra], activity: {...body.activity, status: 'finalized'}})})
  assert.equal(finalResponse.status, 200)
  const closed = await nextActivity()
  assert.equal(closed.status, 'finalized')
  assert.notEqual(closed.id, opened.id)
  assert.equal(closed.ticket.customerName, 'Cliente')
  assert.equal(closed.ticket.total, 35000)
  assert.deepEqual(closed.ticket.services.map(line => line.serviceName), ['CORTE DAMA', 'CEPILLADO'])
  const invalid = await fetch(url + '/ticket-state', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...body, activity: {...body.activity, status: 'finalized'}})})
  assert.equal(invalid.status, 400)
  await reader.cancel()
})

test('a delayed roster refresh cannot reverse a role change on any ticket view', async () => {
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas', 'juan-pablo']) {
    const html = await readFile(path.join(root, 'htmls', view + '.html'), 'utf8')
    const requests = []
    const personalId = 'e69d26e7-d3d7-440e-9117-c71e264a1d70'
    const worker = {id: personalId, name: 'Empleado', specialty: 'ESTILISTA', active: true}
    const context = {
      PERSONAL_WORKER_ID: personalId, activeWorker: {code: personalId.toUpperCase()},
      TICKET_WORKER_SPECIALTY: ({estilistas: 'ESTILISTA', manicuristas: 'MANICURISTA'})[view] || null,
      refreshTicketView() {}, getServiceSpecialties: () => ({}), fetch: () => new Promise(resolve => requests.push(resolve))
    }
    const roster = html.slice(html.indexOf('    const workerCode ='), html.indexOf('    const saveWorkerOrder ='))
    const refresh = html.slice(html.indexOf('    let rosterRequest ='), html.indexOf('    const getTickets =', html.indexOf('    let rosterRequest =')))
    runInNewContext(roster + refresh + '\nglobalThis.refresh = refreshWorkersFromServer; globalThis.visible = getWorkers;', context)
    const old = context.refresh(), current = context.refresh()
    const reply = specialty => ({ok: true, json: async () => ({workers: [{...worker, specialty, active: false}]})})
    requests[1](reply('MANICURISTA'))
    await current
    requests[0](reply('ESTILISTA'))
    await old
    assert.deepEqual(Array.from(context.visible(), person => person.specialty), view === 'estilistas' ? [] : ['MANICURISTA'], view)
    assert.equal(context.activeWorker?.specialty, view === 'estilistas' ? undefined : 'MANICURISTA', view)
  }
})

test('Juan Pablo view filters workers and ticket groups by his ID', async () => {
  const html = await readFile(path.join(root, 'htmls', 'juan-pablo.html'), 'utf8')
  const workerStart = html.indexOf('    const getWorkers =')
  const workerEnd = html.indexOf('    const saveWorkerOrder =', workerStart)
  const id = 'e69d26e7-d3d7-440e-9117-c71e264a1d70'
  const context = {
    PERSONAL_WORKER_ID: id,
    PERSONAL_WORKER_CODE: id.toUpperCase(),
    serverWorkers: [
      {id, name: 'JUAN PABLO', specialty: 'ESTILISTA'},
      {id: 'other-id', name: 'OTRA PERSONA', specialty: 'ESTILISTA'}
    ],
    getLocalWorkers: () => [], getServiceSpecialties: () => ({}),
    workerCode: worker => worker.id.toUpperCase(), TICKET_WORKER_SPECIALTY: null
  }
  runInNewContext(html.slice(workerStart, workerEnd) + '\nglobalThis.personalWorkers = getWorkers;', context)
  assert.deepEqual(Array.from(context.personalWorkers(), worker => worker.name), ['JUAN PABLO'])
  assert.deepEqual(Array.from(context.personalWorkers(true), worker => worker.name), ['JUAN PABLO', 'OTRA PERSONA'])
  const groupStart = html.indexOf('    const ticketGroupVisible =')
  const groupEnd = html.indexOf('    function refreshTicketView', groupStart)
  runInNewContext(html.slice(groupStart, groupEnd) + '\nglobalThis.personalGroupVisible = ticketGroupVisible;', context)
  assert.equal(context.personalGroupVisible({lines: [{workerCode: id.toUpperCase()}]}), true)
  assert.equal(context.personalGroupVisible({lines: [{workerCode: 'OTHER-ID', openAssignedWorkerCode: id.toUpperCase()}]}), true)
  assert.equal(context.personalGroupVisible({lines: [{workerCode: 'OTHER-ID'}]}), false)
})

test('shares actions, rejects stale writes, persists state, and restores with undo', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  let running = await launch(directory)
  const initial = await (await fetch(running.url + '/board')).json()
  const manicuristas = initial.workers.filter(worker => worker.specialty === 'MANICURISTA')
  const person = manicuristas[0], target = manicuristas[1]
  const action = {action: 'reorder', version: initial.version, worker_id: person.id, target_worker_id: target.id, placement: 'after', operation_id: 'test-reorder'}
  const first = await fetch(running.url + '/actions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(action)})
  assert.equal(first.status, 200)
  const moved = await first.json()
  assert.deepEqual(moved.workers.filter(worker => worker.specialty === 'MANICURISTA').slice(0, 2).map(worker => worker.id), [target.id, person.id])
  const duplicate = await fetch(running.url + '/actions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(action)})
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).version, moved.version)
  const stale = await fetch(running.url + '/actions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...action, operation_id: 'stale'})})
  assert.equal(stale.status, 409)
  const undone = await (await fetch(running.url + '/actions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'undo', version: moved.version, operation_id: 'undo'})})).json()
  assert.deepEqual(undone.workers, initial.workers)
  const delayedRetry = await fetch(running.url + '/actions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(action)})
  assert.deepEqual(await delayedRetry.json(), undone)
  const deleted = await (await fetch(running.url + '/actions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'delete', version: undone.version, worker_id: person.id, operation_id: 'delete'})})).json()
  assert.equal(deleted.workers.some(worker => worker.id === person.id), false)
  await close(running.server)
  running = await launch(directory)
  t.after(() => close(running.server))
  const reopened = await (await fetch(running.url + '/board')).json()
  assert.equal(reopened.workers.some(worker => worker.id === person.id), false)
  const disk = JSON.parse(await readFile(path.join(directory, 'tablero.json'), 'utf8'))
  assert.equal(disk.version, reopened.version)
})

test('team visibility checkbox state clears a temporary disable and hides unchecked workers', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-visibility-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  const post = body => fetch(url + '/actions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})
  const initial = await (await fetch(url + '/board')).json()
  const worker = initial.workers[0]
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const backup = {...initial, workers: initial.workers.map(person => person.id === worker.id ? {...person, disabledOn: date} : person)}
  const imported = await (await post({action: 'import', version: initial.version, backup})).json()
  assert.equal(imported.workers.find(person => person.id === worker.id).disabledOn, date)
  const save = (version, active) => post({action: 'save', version, worker_id: worker.id, name: worker.name, specialty: worker.specialty, active, schedule: worker.schedule})
  const shown = await (await save(imported.version, true)).json()
  assert.equal(shown.workers.find(person => person.id === worker.id).disabledOn, undefined)
  assert.equal(shown.workers.find(person => person.id === worker.id).active, true)
  const hidden = await (await save(shown.version, false)).json()
  assert.equal(hidden.workers.find(person => person.id === worker.id).active, false)
  const restored = await (await save(hidden.version, true)).json()
  assert.equal(restored.workers.find(person => person.id === worker.id).active, true)
})

test('Auxiliar is saved for Tickets and cannot enter the board rotation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-auxiliar-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  const initial = await (await fetch(url + '/board')).json()
  const save = await fetch(url + '/actions', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({action: 'save', version: initial.version, name: 'Sofía', specialty: 'AUXILIAR', active: true})
  })
  assert.equal(save.status, 200)
  const saved = await save.json()
  const auxiliar = saved.workers.find(worker => worker.name === 'Sofía')
  assert.equal(auxiliar.specialty, 'AUXILIAR')
  assert.equal(auxiliar.active, false)
  const rotate = await fetch(url + '/actions', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({action: 'rotate', version: saved.version, worker_id: auxiliar.id})
  })
  assert.equal(rotate.status, 400)
  assert.ok((await (await fetch(url + '/board')).json()).workers.some(worker => worker.id === auxiliar.id))
})

test('notifies connected screens after a change', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  const controller = new AbortController()
  t.after(() => controller.abort())
  const events = await fetch(url + '/events', {signal: controller.signal})
  const reader = events.body.getReader()
  const firstEvent = new TextDecoder().decode((await reader.read()).value)
  assert.match(firstEvent, /event: board/)
  const board = await (await fetch(url + '/board')).json()
  const estilistas = board.workers.filter(worker => worker.specialty === 'ESTILISTA')
  await fetch(url + '/actions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'reorder', version: board.version, worker_id: estilistas[0].id, target_worker_id: estilistas[1].id, placement: 'after', operation_id: 'event-test'})})
  const update = new TextDecoder().decode((await reader.read()).value)
  assert.match(update, /event: board/)
  const ticketLine = {id: 'event-line', ticketGroupId: 'event-group', ticketStatus: 'open', workerName: 'Karen', serviceName: 'MANICURE', customerName: 'Ana', amount: 25000}
  const ticketResponse = await fetch(url + '/ticket-state', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'changes', upsert: [ticketLine], deleteIds: [], settings: {}})})
  assert.equal(ticketResponse.status, 200)
  const ticketUpdate = new TextDecoder().decode((await reader.read()).value)
  assert.match(ticketUpdate, /event: tickets/)
  controller.abort()
})

test('shares open tickets and settings across clients and survives a restart', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-tickets-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  let running = await launch(directory)
  const post = (url, body) => fetch(url + '/ticket-state', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})
  const line = (id, group, name) => ({id, ticketGroupId: group, ticketStatus: 'open', createdAt: new Date().toISOString(), workerCode: 'worker-1', workerName: 'Karen', serviceName: 'MANICURE', customerName: name, amount: 25000})
  const first = await post(running.url, {action: 'changes', upsert: [line('line-1', 'group-1', 'Ana')], deleteIds: [], settings: {}})
  assert.equal(first.status, 200)
  const second = await post(running.url, {action: 'changes', upsert: [{...line('line-2', 'group-2', 'Luz'), serviceName: 'PRODUCTO', productName: 'Champú', amount: 32000, paymentMethod: 'credit_card'}], deleteIds: [], settings: {'salon-service-prices-v1': JSON.stringify({MANICURE: 25000}), 'salon-service-specialties-v1': JSON.stringify({MANICURE: 'MANICURISTA', __requiresSupplies: {MANICURE: true, COLOR: false}, __boardIdleSeconds: 30})}})
  assert.equal(second.status, 200)
  const shared = await (await fetch(running.url + '/ticket-state')).json()
  assert.deepEqual(shared.tickets.map(ticket => ticket.customerName), ['Ana', 'Luz'])
  assert.deepEqual(shared.tickets.map(ticket => ticket.ticketNumber), [0, 1])
  assert.equal(shared.tickets[1].paymentMethod, 'credit_card')
  assert.equal(shared.tickets[1].productName, 'Champú')
  assert.equal(shared.tickets[1].amount, 32000)
  assert.equal(JSON.parse(shared.settings['salon-service-prices-v1']).MANICURE, 25000)
  assert.equal(JSON.parse(shared.settings['salon-service-specialties-v1']).MANICURE, 'MANICURISTA')
  assert.equal(JSON.parse(shared.settings['salon-service-specialties-v1']).__requiresSupplies.MANICURE, true)
  assert.equal(JSON.parse(shared.settings['salon-service-specialties-v1']).__boardIdleSeconds, 30)
  const closed = {...shared.tickets[0], ticketStatus: 'finalized'}
  await post(running.url, {action: 'changes', upsert: [closed], deleteIds: [], settings: {}})
  const staleMigration = await post(running.url, {action: 'migrate', upsert: [line('line-1', 'group-1', 'Ana')], deleteIds: [], settings: {}})
  assert.equal((await staleMigration.json()).tickets[0].ticketStatus, 'finalized')
  await close(running.server)
  running = await launch(directory)
  t.after(() => close(running.server))
  const restored = await (await fetch(running.url + '/ticket-state')).json()
  assert.equal(restored.tickets.length, 2)
  assert.equal(restored.tickets[0].ticketStatus, 'finalized')
  assert.equal(restored.tickets[1].paymentMethod, 'credit_card')
  assert.equal(restored.tickets[1].productName, 'Champú')
  assert.equal(restored.nextTicketNumber, 2)
  assert.equal(JSON.parse(restored.settings['salon-service-specialties-v1']).MANICURE, 'MANICURISTA')
  assert.equal(JSON.parse(restored.settings['salon-service-specialties-v1']).__requiresSupplies.COLOR, false)
  assert.equal(JSON.parse(restored.settings['salon-service-specialties-v1']).__boardIdleSeconds, 30)
  const reopened = {...restored.tickets[0], ticketStatus: 'open', enteredAt: null, closedAt: null}
  const response = await post(running.url, {action: 'changes', upsert: [reopened], deleteIds: [], settings: {}})
  assert.equal((await response.json()).tickets[0].ticketStatus, 'open')
  const extra = {...reopened, id: 'line-3', serviceName: 'PEDICURE'}
  await post(running.url, {action: 'changes', upsert: [extra], deleteIds: [], settings: {}})
  const deletedGroup = await post(running.url, {action: 'changes', upsert: [], deleteIds: ['line-1', 'line-3'], settings: {}})
  assert.equal((await deletedGroup.json()).tickets.some(ticket => ticket.ticketGroupId === 'group-1'), false)
})

test('concurrent ticket changes keep status and assignment consistent across the group', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-ticket-race-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  const post = async upsert => {
    const response = await fetch(url + '/ticket-state', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'changes', upsert, deleteIds: [], settings: {}})})
    assert.equal(response.status, 200)
    return (await response.json()).tickets
  }
  const first = {id: 'line-a', ticketGroupId: 'group-a', ticketStatus: 'open', workerName: 'Paola', serviceName: 'MANICURE', customerName: 'Cliente', amount: 20000, openAssignedWorkerCode: 'E1', openAssignedWorkerName: 'Ana'}
  await post([first])
  await post([{...first, ticketStatus: 'finalized', closedAt: '2026-11-17T10:00:00.000Z'}])
  const afterStaleOpen = await post([{...first, id: 'line-b', serviceName: 'PEDICURE', ticketStatus: 'open', amount: 30000, openAssignedWorkerCode: 'M1', openAssignedWorkerName: 'Paola'}])
  assert.deepEqual(afterStaleOpen.map(line => line.ticketStatus), ['open', 'open'])
  assert.ok(afterStaleOpen.every(line => line.closedAt === null))
  assert.ok(afterStaleOpen.every(line => line.openAssignedWorkerName === 'Paola'))
  const afterStaleFinalize = await post([{...first, ticketStatus: 'finalized', closedAt: '2026-11-17T11:00:00.000Z'}])
  assert.deepEqual(afterStaleFinalize.map(line => line.ticketStatus), ['finalized', 'finalized'])
  assert.ok(afterStaleFinalize.every(line => line.closedAt === '2026-11-17T11:00:00.000Z'))
  const replacement = {...afterStaleFinalize[0], id: 'replacement-line'}
  const request = body => fetch(url + '/ticket-state', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})
  const changes = {action: 'changes', upsert: [replacement], deleteIds: afterStaleFinalize.map(line => line.id), settings: {}}
  const replaced = await request(changes)
  assert.equal(replaced.status, 200)
  assert.equal((await replaced.json()).tickets[0].ticketNumber, replacement.ticketNumber)
  const invalid = await request({...changes, upsert: [null], activity: {status: 'open', groupId: 'missing', workerName: 'Ana'}})
  assert.equal(invalid.status, 400)
})

test('tablet ticket storage imports local history and refreshes another tablet', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'josepp-tablets-test-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  const script = await readFile(path.join(root, 'ticket-storage.js'), 'utf8')
  const createTablet = async legacyTickets => {
    const data = new Map(legacyTickets ? [['salon-paper-tickets-v1', JSON.stringify(legacyTickets)]] : [])
    let refresh
    let ticketEvent
    const window = {localStorage: {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)}, addEventListener() {}}
    class EventSource {addEventListener(name, handler) {if (name === 'tickets') ticketEvent = handler}}
    runInNewContext(script, {window, document: {dispatchEvent() {}, addEventListener() {}}, Event: class {}, EventSource, setInterval: callback => {refresh = callback}, alert: message => {throw Error(message)}, fetch: (route, options) => fetch(url + route, options)})
    await window.salonTicketStorage.ready
    return {storage: window.salonTicketStorage, refresh, ticketEvent: () => ticketEvent()}
  }
  const old = {id: 'old-line', ticketGroupId: 'old-group', ticketStatus: 'open', workerName: 'Karen', serviceName: 'MANICURE', customerName: 'Ana', amount: 25000}
  const first = await createTablet([old])
  const second = await createTablet()
  assert.equal(JSON.parse(second.storage.getItem('salon-paper-tickets-v1')).length, 1)
  const newer = {...old, id: 'new-line', ticketGroupId: 'new-group', customerName: 'Luz', openAssignedWorkerCode: 'E2', openAssignedWorkerName: 'María', openAssignedWorkerSpecialty: 'ESTILISTA'}
  second.storage.setItem('salon-paper-tickets-v1', JSON.stringify([old, newer]))
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await (await fetch(url + '/ticket-state')).json()).tickets.length === 2) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  first.ticketEvent()
  for (let attempt = 0; attempt < 30; attempt++) {
    if (JSON.parse(first.storage.getItem('salon-paper-tickets-v1')).length === 2) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.deepEqual(JSON.parse(first.storage.getItem('salon-paper-tickets-v1')).map(ticket => ticket.customerName), ['Ana', 'Luz'])
  assert.equal(JSON.parse(first.storage.getItem('salon-paper-tickets-v1'))[1].openAssignedWorkerName, 'María')
  first.storage.setItem('salon-service-requires-supplies-v1', JSON.stringify({MANICURE: true, COLOR: false}))
  for (let attempt = 0; attempt < 30; attempt++) {
    const shared = await (await fetch(url + '/ticket-state')).json()
    if (JSON.parse(shared.settings['salon-service-specialties-v1'] || '{}').__requiresSupplies?.MANICURE) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await second.refresh()
  assert.deepEqual(JSON.parse(second.storage.getItem('salon-service-requires-supplies-v1')), {MANICURE: true, COLOR: false})
  const sharedSettings = JSON.parse(first.storage.getItem('salon-service-specialties-v1') || '{}')
  assert.equal(await first.storage.setItem('salon-service-specialties-v1', JSON.stringify({...sharedSettings, __boardIdleSeconds: 120})), true)
  await second.refresh()
  assert.equal(JSON.parse(second.storage.getItem('salon-service-specialties-v1')).__boardIdleSeconds, 120)
})

test('independent tablets can save separate tickets, detect conflicts and recover a lost acknowledgement', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'salon-phase2-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const {server, url} = await launch(directory)
  t.after(() => close(server))
  const script = await readFile(path.join(root, 'ticket-storage.js'), 'utf8')
  const key = 'salon-paper-tickets-v1'
  async function tablet() {
    const window = {localStorage: {getItem: () => '1'}}
    let refresh, loseReply = false
    async function transport(route, options) {
      const response = await fetch(url + route, options)
      if (loseReply && options.method === 'POST') {
        loseReply = false
        assert.equal(response.status, 200)
        throw Error('response lost')
      }
      return response
    }
    runInNewContext(script, {window, document: {dispatchEvent() {}}, Event: class {}, alert() {}, setInterval: fn => {refresh = fn}, fetch: transport})
    const storage = window.salonTicketStorage
    await storage.ready
    const read = () => JSON.parse(storage.getItem(key))
    return {read, save: lines => storage.setItem(key, JSON.stringify(lines)), refresh, loseReply: () => {loseReply = true}}
  }
  const [a, b] = await Promise.all([tablet(), tablet()])
  const line = id => ({id, ticketGroupId: id, ticketStatus: 'open', serviceName: 'Corte', workerName: 'Ana', amount: 10000})
  assert.deepEqual(await Promise.all([a.save([line('a')]), b.save([line('b')])]), [true, true])
  await Promise.all([a.refresh(), b.refresh()])
  a.loseReply()
  assert.equal(await a.save(a.read().map(item => item.id === 'a' ? {...item, amount: 25000} : item)), true)
  const staleDeletion = b.save(b.read().filter(item => item.id !== 'a'))
  const queuedReplacement = b.save([...b.read(), line('a')])
  assert.deepEqual(await Promise.all([staleDeletion, queuedReplacement]), [false, false])
  await a.refresh()
  assert.deepEqual(b.read(), a.read())
  assert.equal(b.read().find(item => item.id === 'a').amount, 25000)
  assert.equal(b.read().length, 2)
})

test('late tablet polls cannot undo newer polls or completed saves', async () => {
  const script = await readFile(path.join(root, 'ticket-storage.js'), 'utf8')
  const key = 'salon-paper-tickets-v1'
  const response = tickets => ({ok: true, json: async () => ({tickets, settings: {}, nextTicketNumber: 1})})
  const window = {localStorage: {getItem: () => '1'}}
  const reads = []
  let refresh
  let starting = true
  const fetchMock = async (_, options) => {
    if (starting) return response([])
    if (options.method === 'POST') return response(JSON.parse(options.body).upsert)
    return new Promise(resolve => reads.push(resolve))
  }
  runInNewContext(script, {window, document: {dispatchEvent() {}}, Event: class {}, setInterval: callback => {refresh = callback}, fetch: fetchMock})
  const storage = window.salonTicketStorage
  await storage.ready
  starting = false
  const slow = refresh()
  const fast = refresh()
  reads[1](response([{id: 'current'}]))
  await fast
  reads[0](response([]))
  await slow
  assert.deepEqual(JSON.parse(storage.getItem(key)), [{id: 'current'}])
  const beforeSave = refresh()
  await storage.setItem(key, JSON.stringify([{id: 'saved'}]))
  reads[2](response([]))
  await beforeSave
  assert.deepEqual(JSON.parse(storage.getItem(key)), [{id: 'saved'}])
})

test('a tablet can retry startup and two offline saves cannot leave a phantom ticket', async () => {
  const script = await readFile(path.join(root, 'ticket-storage.js'), 'utf8')
  const key = 'salon-paper-tickets-v1'
  const window = {localStorage: {getItem: () => '1'}}
  let online = false
  let timers = 0
  const fetch = async () => {
    if (!online) throw Error('offline')
    return {ok: true, json: async () => ({tickets: [{id: 'existing'}], settings: {}, nextTicketNumber: 1})}
  }
  runInNewContext(script, {window, fetch, Event: class {}, document: {dispatchEvent() {}}, setInterval: () => {timers++}, alert() {}})
  const storage = window.salonTicketStorage
  await assert.rejects(storage.ready, /offline/)
  online = true
  await Promise.all([storage.ready, storage.ready])
  assert.equal(timers, 1)
  online = false
  const first = storage.setItem(key, JSON.stringify([{id: 'first'}]))
  const second = storage.setItem(key, JSON.stringify([{id: 'second'}]))
  assert.deepEqual(await Promise.all([first, second]), [false, false])
  assert.deepEqual(JSON.parse(storage.getItem(key)), [{id: 'existing'}])
})

test('tablet storage reports failed saves, rolls back, and accepts a retry', async () => {
  const script = await readFile(path.join(root, 'ticket-storage.js'), 'utf8')
  const line = {id: 'line-1', ticketGroupId: 'group-1', ticketStatus: 'open', workerName: 'Ana', serviceName: 'MANICURE', customerName: 'Cliente', amount: 25000}
  let online = true
  let posts = 0
  const alerts = []
  const serverState = {tickets: [], nextTicketNumber: 1, settings: {}}
  const window = {localStorage: {getItem: () => '1', setItem() {}}, addEventListener() {}}
  const fetchMock = async (_route, options) => {
    if (!online) throw Error('Sin conexión')
    if (options.method === 'POST') {posts++; serverState.tickets = JSON.parse(options.body).upsert}
    return {ok: true, json: async () => structuredClone(serverState)}
  }
  runInNewContext(script, {window, document: {dispatchEvent() {}, addEventListener() {}}, Event: class {}, setInterval() {}, alert: message => alerts.push(message), fetch: fetchMock})
  await window.salonTicketStorage.ready
  online = false
  const failed = await window.salonTicketStorage.setItem('salon-paper-tickets-v1', JSON.stringify([line]))
  assert.equal(failed, false)
  assert.equal(JSON.parse(window.salonTicketStorage.getItem('salon-paper-tickets-v1')).length, 0)
  assert.equal(alerts.length, 1)
  online = true
  const saved = await window.salonTicketStorage.setItem('salon-paper-tickets-v1', JSON.stringify([line]))
  assert.equal(saved, true)
  assert.equal(posts, 1)
  assert.equal(JSON.parse(window.salonTicketStorage.getItem('salon-paper-tickets-v1')).length, 1)
})

test('every tablet shows all open and finalized ticket groups', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('    const ticketLineSpecialty =')
  const end = html.indexOf('    const refreshWorkersFromServer =', start)
  assert.ok(start > 0 && end > start)
  const helper = html.slice(start, end)
  const roster = [{id: 'm-id', name: 'Karen', specialty: 'MANICURISTA'}, {id: 'e-id', name: 'Ana', specialty: 'ESTILISTA'}]
  const visible = (specialty, lines) => {
    const context = {TICKET_WORKER_SPECIALTY: specialty, SERVICES_BY_SPECIALTY: {MANICURISTA: ['MANICURE'], ESTILISTA: ['COLOR']}, serverWorkers: roster, getLocalWorkers: () => [], workerCode: worker => worker.id.toUpperCase()}
    runInNewContext(helper + '\nglobalThis.check = ticketGroupVisible;', context)
    return context.check({lines})
  }
  const manicure = {workerCode: 'M-ID', workerName: 'Karen', workerSpecialty: 'MANICURISTA', serviceName: 'MANICURE'}
  const color = {workerCode: 'E-ID', workerName: 'Ana', workerSpecialty: 'ESTILISTA', serviceName: 'COLOR'}
  assert.equal(visible('MANICURISTA', [manicure]), true)
  assert.equal(visible('ESTILISTA', [manicure]), true)
  assert.equal(visible('MANICURISTA', [color]), true)
  assert.equal(visible('ESTILISTA', [color]), true)
  assert.equal(visible('MANICURISTA', [manicure, color]), true)
  assert.equal(visible('ESTILISTA', [manicure, color]), true)
  assert.equal(visible(null, [manicure]), true)
  assert.equal(visible('MANICURISTA', [{workerCode: 'E-ID', workerName: 'Ana', serviceName: 'COLOR'}]), true)
  assert.equal(visible('MANICURISTA', [{workerCode: 'E-ID', workerName: 'Ana', serviceName: 'SERVICIO PERSONALIZADO'}]), true)
  assert.equal(visible('ESTILISTA', [{workerCode: 'E-ID', workerName: 'Ana', serviceName: 'SERVICIO PERSONALIZADO'}]), true)
})

test('long touch on an open ticket asks to delete and scrolling cancels it', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('      content.querySelectorAll("[data-ticket-group]").forEach((card) => {')
  const end = html.indexOf('      content.querySelectorAll("[data-reopen-ticket]")', start)
  assert.ok(start > 0 && end > start)
  const listeners = new Map()
  const card = {dataset: {ticketGroup: 'group-1'}, addEventListener: (type, handler) => listeners.set(type, handler)}
  let timer = null
  let deletion = null
  const context = {
    content: {querySelectorAll: () => [card]}, root: {querySelector: () => null},
    setTimeout: handler => {timer = handler; return 1}, clearTimeout: () => {timer = null},
    confirmDeleteTicket: (_root, id) => {deletion = id}
  }
  runInNewContext(html.slice(start, end), context)
  const touch = (x, y) => ({target: {closest: () => card}, touches: [{clientX: x, clientY: y}]})
  listeners.get('touchstart')(touch(20, 20))
  assert.equal(typeof timer, 'function')
  listeners.get('touchmove')(touch(20, 40))
  assert.equal(timer, null)
  assert.equal(deletion, null)
  listeners.get('touchstart')(touch(20, 20))
  timer()
  assert.equal(deletion, 'group-1')
})

test('Main and Auxiliary history shortcut opens History while the menu Tickets button opens Tickets', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('    const showTickets = () => {')
  const end = html.indexOf('    document.querySelector(".tickets-link")', start)
  assert.ok(start > 0 && end > start)
  let click, floatingClick, historyClick
  let pricesOpen = true
  let ticketsOpen = true
  const openedViews = []
  let renders = 0
  const existingRoot = {dataset: {}}
  const context = {
    navigationVersion: 0, openTicketId: '', ticketClientName: 'Existing client', requestTicketCustomer: () => {},
    launcher: {addEventListener: (_event, handler) => {click = handler}},
    historyLauncher: {addEventListener: (_event, handler) => {historyClick = handler}},
    document: {createElement: () => ({setAttribute() {}, addEventListener: (_event, handler) => {floatingClick = handler}}), querySelector: selector => {
      if (selector === '#paper-prices [data-close]') return pricesOpen ? {click: () => {pricesOpen = false}} : null
      if (selector === '#paper-tickets') return ticketsOpen ? existingRoot : null
      return null
    }},
    renderTickets: () => {renders++},
    openTickets: view => {openedViews.push(view)}
  }
  runInNewContext(html.slice(start, end), context)
  assert.equal(typeof floatingClick, 'function')
  click()
  assert.equal(pricesOpen, true)
  assert.deepEqual(openedViews, [])
  assert.equal(renders, 1)
  assert.equal(existingRoot.dataset.view, 'tickets')
  floatingClick()
  assert.equal(existingRoot.dataset.view, 'history')
  assert.equal(renders, 2)
  pricesOpen = true
  ticketsOpen = false
  floatingClick()
  assert.equal(pricesOpen, true)
  assert.deepEqual(openedViews, ['history'])
  historyClick()
  assert.deepEqual(openedViews, ['history', 'history'])
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas']) {
    const page = await readFile(path.join(root, 'htmls', `${view}.html`), 'utf8')
    assert.match(page, view === 'main' || view === 'auxiliar' ? /ticketFab\.addEventListener\("click", showHistory\)/ : /ticketFab\.addEventListener\("click", showTickets\)/, view)
    if (view === 'main' || view === 'auxiliar') assert.match(page, /ticketFab\.textContent = "Historial de ticket"/, view)
    assert.match(page, /#paper-ticket-fab\{position:fixed;left:50%;bottom:/, view)
  }
  assert.match(html, /renderTickets\(root\);\s*if \(promptForCustomer[^\n]+requestTicketCustomer\(root\);\s*document\.querySelector\("#paper-prices \[data-close\]"\)\?\.click\(\);\s*syncPageScrollLock\(\);\s*root\.workerRefreshTimer/)
})

test('ticket shortcut sits between two available cards or below the single available name', async () => {
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas']) {
    const html = await readFile(path.join(root, 'htmls', `${view}.html`), 'utf8')
    const start = html.indexOf('    const placeTicketFab = () => {')
    const end = html.indexOf('    new MutationObserver(placeTicketFab)', start)
    assert.ok(start > 0 && end > start, view)
    const body = {append(button) {button.parentElement = body}}
    const ticketFab = {parentElement: body}
    const first = {}
    const second = {}
    const firstName = {parentElement: first, after(button) {button.parentElement = first; button.previousElementSibling = firstName}}
    const secondName = {parentElement: second, after(button) {button.parentElement = second; button.previousElementSibling = secondName}}
    first.querySelector = () => firstName
    second.querySelector = () => secondName
    const panels = {
      querySelectorAll: () => [first, second],
      insertBefore(button, next) {button.parentElement = panels; button.nextElementSibling = next}
    }
    let overlay = false
    const document = {body, querySelector: selector => selector === '.queue-board .available-panels' ? panels : overlay ? {} : null}
    runInNewContext(html.slice(start, end) + '\nplaceTicketFab();', {document, ticketFab, TICKET_WORKER_SPECIALTY: view === 'manicuristas' ? 'MANICURISTA' : view === 'estilistas' ? 'ESTILISTA' : null})
    assert.equal(ticketFab.parentElement, ['main', 'auxiliar'].includes(view) ? panels : view === 'estilistas' ? second : first, view)
    if (ticketFab.parentElement === panels) assert.equal(ticketFab.nextElementSibling, second, view)
    else assert.equal(ticketFab.previousElementSibling, view === 'estilistas' ? secondName : firstName, view)
    overlay = true
    runInNewContext(html.slice(start, end) + '\nplaceTicketFab();', {document, ticketFab, TICKET_WORKER_SPECIALTY: null})
    assert.equal(ticketFab.parentElement, body, view)
  }
})

test('leaving a ticket open clears the customer and lines but keeps the selected worker', async () => {
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas']) {
    const html = await readFile(path.join(root, 'htmls', `${view}.html`), 'utf8')
    const start = html.indexOf('      const save = async (keepOpen, selectedOpenWorker = null) => {')
    const end = html.indexOf('      content.querySelector(\'[data-action="save-open"]\')', start)
    assert.ok(start > 0 && end > start, view)
    let stored = null
    let rendered = false
    let confirmSave
    const saveButton = {disabled: false}
    const finalizeButton = {disabled: false}
    const worker = view === 'manicuristas'
      ? {code: 'M1', name: 'Ana', specialty: 'MANICURISTA'}
      : {code: 'A1', name: 'Sofía', specialty: 'AUXILIAR'}
    const serviceName = worker.specialty === 'AUXILIAR' ? 'CORTE DAMA' : 'MANICURE'
    const context = {
      activeGroup: null, activeWorker: worker,
      ticketClientName: 'Cliente nuevo', ticketClientLastName: 'Apellido', ticketScreen: 'new', openTicketId: '',
      pendingTicketLines: [{workerCode: worker.code, workerName: worker.name, workerSpecialty: worker.specialty, serviceName, amount: 50000, supplies: []}],
      editingPendingIndex: -1, selectedTicketServices: new Map([[serviceName, '50000']]), selectedTicketSupplies: new Map(),
      selectedProductName: '', overriddenPrices: new Set(), selectedTicketService: serviceName, ticketAmount: '50000',
      getTickets: () => [], nextTicketNumber: () => 12, ticketId: () => 'ticket-12', localDate: () => '2026-11-17',
      validUsage: usage => usage, saveTickets: tickets => {stored = tickets; return new Promise(resolve => {confirmSave = resolve})}, NEXT_TICKET_KEY: 'next-ticket', localStorage: {setItem() {}},
      renderTickets: () => {rendered = true}, root: {}, content: {querySelector: selector => selector.includes('save-open') ? saveButton : finalizeButton},
      alert: message => {throw new Error(message)}, ticketSaveInFlight: false, ticketDrafts: new Map()
    }
    runInNewContext(html.slice(start, end) + '\nglobalThis.saveTicket = save;', context)
    const saving = context.saveTicket(true, {code: 'E2', name: 'María', specialty: 'ESTILISTA'})
    assert.equal(stored?.[0]?.ticketStatus, 'open', view)
    assert.equal(stored?.[0]?.customerName, 'Cliente nuevo', view)
    assert.equal(stored?.[0]?.openAssignedWorkerCode, 'E2', view)
    assert.equal(stored?.[0]?.openAssignedWorkerName, 'María', view)
    assert.equal(context.ticketClientName, 'Cliente nuevo', view)
    assert.equal(context.pendingTicketLines.length, 1, view)
    assert.equal(saveButton.disabled, true, view)
    confirmSave(true)
    await saving
    assert.equal(context.openTicketId, '', view)
    assert.equal(context.ticketClientName, '', view)
    assert.equal(context.ticketClientLastName, '', view)
    assert.equal(context.activeWorker.code, worker.code, view)
    assert.equal(context.ticketScreen, 'new', view)
    assert.equal(context.pendingTicketLines.length, 0, view)
    assert.equal(saveButton.disabled, false, view)
    assert.ok(rendered, view)
    const firstLine = stored[0]
    context.activeGroup = {id: firstLine.ticketGroupId, ticketNumber: firstLine.ticketNumber, customerName: firstLine.customerName, customerLastName: '', lines: [firstLine]}
    context.getTickets = () => [firstLine]
    context.ticketId = () => 'additional-line'
    context.pendingTicketLines = [{workerCode: worker.code, workerName: worker.name, workerSpecialty: worker.specialty, serviceName: worker.specialty === 'AUXILIAR' ? 'CEPILLADO' : 'PEDICURE', amount: 30000, supplies: []}]
    const savingAgain = context.saveTicket(true, {code: 'M2', name: 'Dayana', specialty: 'MANICURISTA'})
    assert.equal(stored.length, 2, view)
    assert.ok(stored.every(line => line.openAssignedWorkerCode === 'M2' && line.openAssignedWorkerName === 'Dayana'), view)
    confirmSave(true)
    await savingAgain
    const existingLines = stored
    context.activeGroup = {...context.activeGroup, lines: existingLines}
    context.getTickets = () => existingLines
    context.pendingTicketLines = []
    const reassigning = context.saveTicket(true, {code: 'E1', name: 'Ana', specialty: 'ESTILISTA'})
    assert.equal(stored.length, 2, view)
    assert.ok(stored.every(line => line.openAssignedWorkerCode === 'E1' && line.openAssignedWorkerName === 'Ana'), view)
    confirmSave(true)
    await reassigning
    const accepted = stored
    let warning = ''
    context.alert = message => {warning = message}
    context.getTickets = () => accepted.map(line => ({...line, ticketStatus: 'finalized'}))
    await context.saveTicket(true, worker)
    assert.match(warning, /cambió en otra pantalla/, view)
    assert.equal(stored, accepted, view)
  }
})

test('reopening a cross-specialty ticket selects its assigned worker on the receiving tablet', async () => {
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas']) {
    const html = await readFile(path.join(root, 'htmls', `${view}.html`), 'utf8')
    const switchStart = html.indexOf('      const switchTicketDraft = (targetId) => {')
    const switchEnd = html.indexOf('      content.querySelector(\'[data-action="new"]\')', switchStart)
    const openStart = html.indexOf('        const openSelectedTicket = () => {', switchEnd)
    const openEnd = html.indexOf('        button.addEventListener("click", openSelectedTicket);', openStart)
    assert.ok(switchStart > 0 && switchEnd > switchStart && openStart > switchEnd && openEnd > openStart, view)
    const manicurist = {code: 'M1', name: 'Dayana', specialty: 'MANICURISTA'}
    const group = {id: 'group-1', lines: [
      {workerCode: 'A1', workerName: 'Sofía', workerSpecialty: 'AUXILIAR', openAssignedWorkerCode: 'M1'},
      {workerCode: 'E1', workerName: 'Ana', workerSpecialty: 'ESTILISTA', openAssignedWorkerCode: 'M1'}
    ]}
    let rendered = false
    const context = {
      button: {dataset: {open: group.id}}, openGroups: [group], workers: [manicurist],
      openTicketId: '', ticketScreen: 'new', ticketClientName: 'Unfinished client', ticketClientLastName: '', activeWorker: null,
      pendingTicketLines: [{serviceName: 'MANICURE', amount: 5000}], ticketDrafts: new Map(),
      selectedTicketService: '', selectedTicketServices: new Map(), selectedTicketSupplies: new Map(),
      selectedProductName: '', overriddenPrices: new Set(), ticketAmount: '', editingPendingIndex: -1,
      root: {scrollTop: 10}, renderTickets: () => {rendered = true}
    }
    runInNewContext(html.slice(switchStart, switchEnd) + html.slice(openStart, openEnd) + '\nglobalThis.openTicket = openSelectedTicket; globalThis.switchDraft = switchTicketDraft;', context)
    context.openTicket()
    assert.equal(context.activeWorker.code, 'M1', view)
    assert.equal(context.openTicketId, group.id, view)
    assert.equal(context.pendingTicketLines.length, 0, view)
    assert.equal(context.ticketDrafts.get('')?.lines[0]?.serviceName, 'MANICURE', view)
    assert.equal(context.root.scrollTop, 0, view)
    assert.ok(rendered, view)
    context.switchDraft('')
    assert.equal(context.ticketClientName, 'Unfinished client', view)
    assert.equal(context.pendingTicketLines[0].serviceName, 'MANICURE', view)
    context.button.dataset.open = 'group-other-specialty'
    context.openGroups = [{id: 'group-other-specialty', lines: [{workerCode: 'E1', openAssignedWorkerCode: 'E1'}]}]
    context.activeWorker = null
    context.openTicket()
    assert.equal(context.activeWorker.code, 'M1', `${view}: offers local services when the assignee belongs to another specialty`)
  }
})

test('a rejected open-ticket save leaves the form ready to retry', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('      const save = async (keepOpen, selectedOpenWorker = null) => {')
  const end = html.indexOf('      content.querySelector(\'[data-action="save-open"]\')', start)
  let rendered = false
  const button = {disabled: false}
  const context = {
    activeGroup: null, activeWorker: {code: 'M1', name: 'Ana', specialty: 'MANICURISTA'},
    ticketClientName: 'Cliente nuevo', ticketClientLastName: '', ticketScreen: 'new', openTicketId: '',
    pendingTicketLines: [{workerCode: 'M1', workerName: 'Ana', workerSpecialty: 'MANICURISTA', serviceName: 'MANICURE', amount: 50000, supplies: []}],
    editingPendingIndex: -1, selectedTicketServices: new Map(), selectedTicketSupplies: new Map(), selectedProductName: '', overriddenPrices: new Set(),
    selectedTicketService: '', ticketAmount: '', getTickets: () => [], nextTicketNumber: () => 12, ticketId: () => 'ticket-12', localDate: () => '2026-11-17',
    validUsage: usage => usage, saveTickets: async () => false, localStorage: {setItem() {throw Error('Counter must not advance')}},
    renderTickets: () => {rendered = true}, root: {}, content: {querySelector: () => button}, alert: message => {throw Error(message)}, ticketSaveInFlight: false
  }
  runInNewContext(html.slice(start, end) + '\nglobalThis.saveTicket = save;', context)
  await context.saveTicket(true, {code: 'E2', name: 'María', specialty: 'ESTILISTA'})
  assert.equal(context.ticketClientName, 'Cliente nuevo')
  assert.equal(context.pendingTicketLines.length, 1)
  assert.equal(context.activeWorker.name, 'Ana')
  assert.equal(context.openTicketId, '')
  assert.equal(context.ticketSaveInFlight, false)
  assert.equal(button.disabled, false)
  assert.equal(rendered, false)
})

test('service specialty filters the catalog and honors saved changes', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('    const getServiceSpecialties =')
  const end = html.indexOf('    const getPrices =', start)
  assert.ok(start > 0 && end > start)
  const settings = new Map()
  const context = {
    SERVICE_SPECIALTIES_KEY: 'salon-service-specialties-v1',
    localStorage: {getItem: key => settings.get(key) ?? null},
    SERVICES_BY_SPECIALTY: {MANICURISTA: ['MANICURE'], ESTILISTA: ['CORTE DAMA']},
    getAllServices: () => ['MANICURE', 'CORTE DAMA', 'MANICURE SECADO RAPIDO', 'AFEITADA DE BARBA', 'PRODUCTO']
  }
  runInNewContext(html.slice(start, end) + '\nglobalThis.forSpecialty = servicesForSpecialty;', context)
  assert.deepEqual(Array.from(context.forSpecialty('MANICURISTA')), ['MANICURE', 'MANICURE SECADO RAPIDO', 'PRODUCTO'])
  assert.deepEqual(Array.from(context.forSpecialty('ESTILISTA')), ['CORTE DAMA', 'AFEITADA DE BARBA', 'PRODUCTO'])
  assert.deepEqual(Array.from(context.forSpecialty('AUXILIAR')), ['CORTE DAMA', 'AFEITADA DE BARBA', 'PRODUCTO'])
  settings.set('salon-service-specialties-v1', JSON.stringify({'AFEITADA DE BARBA': 'MANICURISTA'}))
  assert.deepEqual(Array.from(context.forSpecialty('MANICURISTA')), ['MANICURE', 'MANICURE SECADO RAPIDO', 'AFEITADA DE BARBA', 'PRODUCTO'])
  assert.deepEqual(Array.from(context.forSpecialty('ESTILISTA')), ['CORTE DAMA', 'PRODUCTO'])
  assert.deepEqual(Array.from(context.forSpecialty('AUXILIAR')), ['CORTE DAMA', 'PRODUCTO'])
  settings.set('salon-service-specialties-v1', JSON.stringify({'CORTE DAMA': ['ESTILISTA', 'AUXILIAR'], 'MANICURE': ['MANICURISTA', 'AUXILIAR']}))
  assert.deepEqual(Array.from(context.forSpecialty('MANICURISTA')), ['MANICURE', 'MANICURE SECADO RAPIDO', 'PRODUCTO'])
  assert.deepEqual(Array.from(context.forSpecialty('ESTILISTA')), ['CORTE DAMA', 'AFEITADA DE BARBA', 'PRODUCTO'])
  assert.deepEqual(Array.from(context.forSpecialty('AUXILIAR')), ['MANICURE', 'CORTE DAMA', 'AFEITADA DE BARBA', 'PRODUCTO'])
})

test('service order persists and keeps PRODUCTO available', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('    const getCustomServices =')
  const end = html.indexOf('    const getServiceSupplyRequirements =', start)
  const settings = new Map([['deleted', JSON.stringify(['PRODUCTO'])]])
  const context = {
    PAPER_SERVICES: ['CORTE', 'MANICURE', 'PRODUCTO'],
    CUSTOM_SERVICES_KEY: 'custom', DELETED_SERVICES_KEY: 'deleted', SERVICE_SPECIALTIES_KEY: 'specialties',
    SERVICES_BY_SPECIALTY: {MANICURISTA: ['MANICURE'], ESTILISTA: ['CORTE']},
    localStorage: {getItem: key => settings.get(key) ?? null, setItem: (key, value) => settings.set(key, value)}
  }
  runInNewContext(html.slice(start, end) + '\nglobalThis.catalog = getAllServices; globalThis.reorder = saveServiceOrder;', context)
  assert.deepEqual(Array.from(context.catalog()), ['CORTE', 'MANICURE', 'PRODUCTO'])
  context.reorder(['PRODUCTO', 'CORTE', 'MANICURE'])
  assert.deepEqual(Array.from(context.catalog()), ['PRODUCTO', 'CORTE', 'MANICURE'])
  assert.deepEqual(JSON.parse(settings.get('specialties')).__serviceOrder, ['PRODUCTO', 'CORTE', 'MANICURE'])
})

test('holding a board card and dragging it reorders without rotating on release', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('    function enhanceQueueButtons()')
  const end = html.indexOf('    new MutationObserver(', start)
  assert.ok(start > 0 && end > start)
  const listeners = new Map()
  const moved = []
  const timers = []
  const column = {getBoundingClientRect: () => ({left: 0, right: 100, top: 0, bottom: 200})}
  const classList = {add() {}, remove() {}}
  const sourceItem = {parentElement: column, classList}
  const targetItem = {parentElement: column, classList, querySelector: () => targetButton}
  column.children = [sourceItem, targetItem]
  const sourceButton = {dataset: {}, closest: () => sourceItem, addEventListener: (name, listener) => listeners.set(name, listener), name: 'Ana'}
  const targetButton = {closest: selector => selector === 'li' ? targetItem : targetButton, getBoundingClientRect: () => ({top: 0, height: 100}), name: 'Luz'}
  const document = {
    querySelectorAll: selector => selector === '.queue-person:not([data-reorder-ready])' ? [sourceButton] : [],
    elementFromPoint: () => targetButton
  }
  runInNewContext(html.slice(start, end) + '\nenhanceQueueButtons();', {document, setTimeout: callback => {timers.push(callback); return timers.length}, clearTimeout() {}, queueName: button => button.name, saveQueueMove: (...args) => {moved.push(args); return Promise.resolve(true)}})
  let blocked = 0
  const touch = (x, y) => ({touches: [{clientX: x, clientY: y}], preventDefault() {blocked++}, stopPropagation() {blocked++}})
  listeners.get('touchstart')(touch(0, 0))
  timers.at(-1)()
  listeners.get('touchmove')(touch(0, 90))
  listeners.get('touchend')(touch(0, 90))
  listeners.get('click')({preventDefault() {blocked++}, stopImmediatePropagation() {blocked++}})
  assert.deepEqual(moved, [['Ana', 'Luz', false]])
  assert.ok(blocked >= 4)
  assert.equal(sourceButton.handle, undefined)
})

test('all four views use card dragging without the old six-dot handle', async () => {
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas']) {
    const html = await readFile(path.join(root, 'htmls', `${view}.html`), 'utf8')
    assert.match(html, /pressTimer = setTimeout\(startDrag, 350\)/, view)
    assert.doesNotMatch(html, /reorder-handle|reorder-target-before|const nameOf = \(button\) =>/, view)
  }
})

test('queue drag retries when another tablet changes the board first', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('    async function saveQueueMove(')
  const end = html.indexOf('    function enhanceQueueButtons()', start)
  assert.ok(start > 0 && end > start)
  let reads = 0
  const posts = []
  const context = {
    ticketId: () => 'move-test',
    alert: message => {throw new Error(message)},
    fetch: async (url, options) => {
      if (url === '/board') return {json: async () => ({version: ++reads, workers: [{id: 'one', name: 'Ana'}, {id: 'two', name: 'Luz'}]})}
      const body = JSON.parse(options.body)
      posts.push(body)
      return posts.length === 1 ? {ok: false, status: 409} : {ok: true, status: 200}
    }
  }
  runInNewContext(html.slice(start, end), context)
  assert.equal(await context.saveQueueMove('Ana', 'Luz', false), true)
  assert.deepEqual(posts.map(post => post.version), [1, 2])
})

test('ticket workers include unchecked employees and keep their order across tablets', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('    const getLocalWorkers =')
  const end = html.indexOf('    const ticketLineSpecialty =', start)
  assert.ok(start > 0 && end > start)
  const workers = [
    {code: 'M1', name: 'Ana', specialty: 'MANICURISTA', active: true},
    {code: 'E1', name: 'Luz', specialty: 'ESTILISTA', active: true},
    {code: 'M2', name: 'Eva', specialty: 'MANICURISTA', active: true},
    {code: 'M3', name: 'Sol', specialty: 'MANICURISTA', active: false},
    {code: 'A1', name: 'Sofía', specialty: 'AUXILIAR', active: false}
  ]
  const settings = {}
  const context = {
    serverWorkers: workers, TICKET_WORKER_SPECIALTY: 'MANICURISTA', SERVICE_SPECIALTIES_KEY: 'specialties',
    workerCode: worker => worker.code, getServiceSpecialties: () => settings,
    localStorage: {setItem: (_key, value) => Object.assign(settings, JSON.parse(value))}
  }
  runInNewContext(html.slice(start, end) + '\nglobalThis.roster = getWorkers; globalThis.reorderWorkers = saveWorkerOrder;', context)
  assert.deepEqual(Array.from(context.roster(), worker => worker.code), ['M1', 'M2', 'M3'])
  context.reorderWorkers(['M2', 'M1'])
  assert.deepEqual(settings.__workerOrder, ['M2', 'E1', 'M1', 'M3', 'A1'])
  assert.deepEqual(Array.from(context.roster(), worker => worker.code), ['M2', 'M1', 'M3'])
  context.TICKET_WORKER_SPECIALTY = 'ESTILISTA'
  assert.deepEqual(Array.from(context.roster(), worker => worker.code), ['E1', 'A1'])
})

test('selecting a service adds a ticket line and marks missing prices for direct entry', async () => {
  const html = (await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')).replace(/\r\n/g, '\n')
  const start = html.indexOf('      content.querySelectorAll("[data-service]").forEach((button) => button.addEventListener("click", () => {')
  const end = html.indexOf('      content.querySelectorAll("[data-service]").forEach((button) => {\n        let timer', start)
  assert.ok(start > 0 && end > start)
  let click
  let renders = 0
  const button = {dataset: {service: 'CORTE'}, addEventListener: (_name, callback) => {click = callback}}
  const context = {
    content: {querySelectorAll: () => [button]}, activeWorker: {code: '1', name: 'Ana', specialty: 'ESTILISTA'},
    suppressServiceClickUntil: 0, pendingTicketLines: [], editingPendingIndex: -1,
    selectedTicketServices: new Map(), selectedTicketSupplies: new Map(), selectedProductName: '',
    overriddenPrices: new Set(), selectedTicketService: '', ticketAmount: '', root: {},
    openTicketId: '', ticketClientName: 'Cliente de prueba',
    ticketId: () => '1', servicePrice: name => name === 'CORTE' ? 20000 : null, requiresSupplies: name => name === 'COLOR',
    validUsage: usage => usage, renderTickets: () => {renders++}
  }
  runInNewContext(html.slice(start, end), context)
  click()
  assert.equal(context.pendingTicketLines.length, 1)
  assert.equal(context.pendingTicketLines[0].serviceName, 'CORTE')
  assert.equal(context.pendingTicketLines[0].amount, 20000)
  assert.equal(context.pendingTicketLines[0].needsPrice, false)
  button.dataset.service = 'COLOR'
  click()
  assert.equal(context.pendingTicketLines[1].amount, 0)
  assert.equal(context.pendingTicketLines[1].needsPrice, true)
  assert.equal(context.pendingTicketLines[1].priceEntered, false)
  assert.equal(context.pendingTicketLines[1].serviceName, 'COLOR')
  assert.equal(Array.from(context.pendingTicketLines[1].supplies).length, 0)
  assert.equal(renders, 2)
  let continueAfterName
  context.ticketClientName = ''
  context.requestTicketCustomer = (_root, onReady) => {continueAfterName = onReady}
  click()
  assert.equal(context.pendingTicketLines.length, 2)
  assert.equal(typeof continueAfterName, 'function')
  context.ticketClientName = 'Cliente de prueba'
  continueAfterName()
  assert.equal(context.pendingTicketLines.length, 3)
})

test('every ticket view asks for a customer name when starting a new ticket', async () => {
  for (const name of ['main', 'auxiliar', 'manicuristas', 'estilistas', 'juan-pablo']) {
    const html = await readFile(path.join(root, 'htmls', `${name}.html`), 'utf8')
    assert.match(html, /function requestTicketCustomer\(root, onReady\)/)
    assert.match(html, /data-ticket-customer-modal/)
    assert.match(html, /ticketClientName = name;\s+close\(\);\s+renderTickets\(root\);\s+onReady\?\.\(\)/)
    assert.match(html, /data-action="new"[\s\S]*?requestTicketCustomer\(root\)/)
    assert.match(html, /if \(!openTicketId && !ticketClientName\.trim\(\)\) requestTicketCustomer\(root, addService\)/)
  }
})

test('Valor accepts a numeric quantity for each insumo on a pending service', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('      const supplyFields = pendingTicketLines.map(')
  const end = html.indexOf('      content.querySelectorAll("[data-service]").forEach((button) => button.classList.toggle', start)
  assert.ok(start > 0 && end > start)
  const listeners = {}
  const input = {
    dataset: {pendingSupply: '0', name: 'TINTE'},
    dispatchEvent: event => listeners[event.type](),
    value: '0',
    addEventListener: (event, handler) => { listeners[event] = handler },
    blur() {}
  }
  let onStep
  let editor
  const line = {serviceName: 'COLOR', supplies: []}
  const context = {
    pendingTicketLines: [line], requiresSupplies: () => true,
    validUsage: usage => usage.filter(item => Number.isSafeInteger(item.quantity) && item.quantity > 0),
    getSupplies: () => ['TINTE'], esc: value => value,
    Event,
    document: {createElement: () => ({
      querySelectorAll: () => [input],
      addEventListener: (type, handler) => { if (type === 'click') onStep = handler }
    })},
    valuePane: {querySelector: () => ({before: node => { editor = node }})}
  }
  runInNewContext(html.slice(start, end), context)
  assert.match(editor.innerHTML, /TINTE/)
  assert.match(editor.innerHTML, /type="number"/)
  input.value = '3'
  listeners.input()
  assert.equal(line.supplies[0].name, 'TINTE')
  assert.equal(line.supplies[0].quantity, 3)
  const step = delta => onStep({target: {closest: () => ({
    dataset: {step: String(delta)}, closest: () => ({querySelector: () => input})
  })}})
  step(1)
  assert.equal(line.supplies[0].quantity, 4)
  step(-1)
  assert.equal(line.supplies[0].quantity, 3)
  input.value = '0'
  listeners.input()
  assert.equal(line.supplies.length, 0)
})

test('all four views format and parse prices with thousands dots', async () => {
  for (const name of ['main', 'manicuristas', 'estilistas', 'auxiliar']) {
    const html = await readFile(path.join(root, 'htmls', `${name}.html`), 'utf8')
    const start = html.indexOf('    const priceDigits =')
    const end = html.indexOf('    const esc =', start)
    assert.ok(start > 0 && end > start)
    const context = {document: {addEventListener() {}, activeElement: null}}
    runInNewContext(html.slice(start, end) + '\nglobalThis.priceTools = {formatPrice, priceNumber, formatPriceInput};', context)
    assert.equal(context.priceTools.formatPrice(50000), '50.000')
    assert.equal(context.priceTools.formatPrice(1250000), '1.250.000')
    assert.equal(context.priceTools.priceNumber('1.250.000'), 1250000)
    assert.equal(context.priceTools.priceNumber('50.000'), 50000)
  }
})

test('product price input updates the ticket total without rerendering', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('      content.querySelectorAll("[data-pending-product-price]")')
  const end = html.indexOf('      content.querySelectorAll("[data-pending-price]")', start)
  assert.ok(start > 0 && end > start)
  const handlers = new Map()
  const priceInput = {dataset: {pendingProductPrice: '0'}, value: '25x000', addEventListener: (event, handler) => handlers.set(event, handler)}
  const total = {textContent: ''}
  const line = {serviceName: 'PRODUCTO', amount: 0, productPriceEntered: false}
  const context = {
    content: {querySelectorAll: () => [priceInput], querySelector: () => total},
    pendingTicketLines: [line], registeredTotal: 10000, money: amount => String(amount),
    document: {activeElement: null, addEventListener() {}}
  }
  const helperStart = html.indexOf('    const priceDigits =')
  const helperEnd = html.indexOf('    const esc =', helperStart)
  runInNewContext(html.slice(helperStart, helperEnd) + html.slice(start, end), context)
  handlers.get('input')()
  assert.equal(priceInput.value, '25.000')
  assert.equal(line.amount, 25000)
  assert.equal(line.productPriceEntered, true)
  assert.equal(total.textContent, '35000')
})

test('a service without a fixed price keeps Eliminar and updates total from its numeric field', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  assert.match(html, /line\.pending && line\.needsPrice \? `<div class="pt-unpriced-line"[\s\S]*?data-pending-price="\$\{index - persistedLines\.length\}"[\s\S]*?data-delete-pending="\$\{index - persistedLines\.length\}">Eliminar<\/button>/)
  const start = html.indexOf('      content.querySelectorAll("[data-pending-price]")')
  const end = html.indexOf('      content.querySelector(\'[data-action="add-line"]\')', start)
  assert.ok(start > 0 && end > start)
  const handlers = new Map()
  const input = {dataset: {pendingPrice: '0'}, value: '25x000', addEventListener: (event, handler) => handlers.set(event, handler)}
  const total = {textContent: ''}
  const line = {serviceName: 'CORTE', amount: 0, needsPrice: true, priceEntered: false}
  const context = {content: {querySelectorAll: () => [input], querySelector: () => total}, pendingTicketLines: [line], registeredTotal: 10000, money: amount => String(amount), document: {activeElement: null, addEventListener() {}}}
  const helperStart = html.indexOf('    const priceDigits =')
  const helperEnd = html.indexOf('    const esc =', helperStart)
  runInNewContext(html.slice(helperStart, helperEnd) + html.slice(start, end), context)
  handlers.get('input')()
  assert.equal(input.value, '25.000')
  assert.equal(line.amount, 25000)
  assert.equal(line.priceEntered, true)
  assert.equal(total.textContent, '35000')
})

test('swiping over services scrolls without starting a drag or selecting', async () => {
  const html = (await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')).replace(/\r\n/g, '\n')
  const start = html.indexOf('      content.querySelectorAll("[data-service]").forEach((button) => {\n        let timer')
  const end = html.indexOf('      content.querySelectorAll("[data-edit-supplies]")', start)
  assert.ok(start > 0 && end > start)
  const handlers = new Map()
  let dragStarted = false
  let nativeScrollPrevented = false
  const grid = {classList: {add: () => {dragStarted = true}, remove() {}}}
  const button = {dataset: {service: 'CORTE'}, parentElement: grid, classList: {add() {}, remove() {}}, addEventListener: (event, handler) => handlers.set(event, handler)}
  let scheduled
  const context = {
    content: {querySelectorAll: () => [button]}, Date: {now: () => 100},
    setTimeout: callback => {scheduled = callback; return 1}, clearTimeout: () => {scheduled = null},
    suppressServiceClickUntil: 0, document: {elementFromPoint: () => null},
    saveServiceOrder: () => {throw Error('A swipe must not reorder')}, renderTickets() {}, root: {}
  }
  runInNewContext(html.slice(start, end), context)
  handlers.get('touchstart')({touches: [{clientX: 10, clientY: 10}]})
  handlers.get('touchmove')({touches: [{clientX: 10, clientY: 40}], preventDefault: () => {nativeScrollPrevented = true}})
  handlers.get('touchend')()
  assert.equal(scheduled, null)
  assert.equal(dragStarted, false)
  assert.equal(nativeScrollPrevented, false)
  assert.ok(context.suppressServiceClickUntil > 100)
})

test('background ticket updates keep a focused price field mounted', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('    function refreshTicketView(root)')
  const end = html.indexOf('    const refreshWorkersFromServer =', start)
  assert.ok(start > 0 && end > start)
  const priceInput = {matches: selector => selector.includes('input:not([type="checkbox"])')}
  let rendered = 0
  const context = {document: {activeElement: priceInput}, renderTickets: () => {rendered++}}
  runInNewContext(html.slice(start, end) + '\nglobalThis.refresh = refreshTicketView;', context)
  const ticketRoot = {isConnected: true, contains: element => element === priceInput, pendingTicketRefresh: false}
  context.refresh(ticketRoot)
  assert.equal(rendered, 0)
  assert.equal(ticketRoot.pendingTicketRefresh, true)
  context.document.activeElement = null
  context.refresh(ticketRoot)
  assert.equal(rendered, 1)
  assert.equal(ticketRoot.pendingTicketRefresh, false)
})

test('ticket controls scroll away with the ticket content', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const start = html.indexOf('      const ticketControls =')
  const end = html.indexOf('      root.addEventListener("focusout"', start)
  assert.ok(start > 0 && end > start)
  const classes = new Set()
  const control = {style: {transform: ''}}
  let onScroll
  let frame
  const ticketRoot = {scrollTop: 0, addEventListener: (_name, callback) => {onScroll = callback}}
  runInNewContext(html.slice(start, end), {root: ticketRoot, requestAnimationFrame: callback => {frame = callback; return 1}, document: {
    querySelector: () => control,
    body: {classList: {toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)}}
  }})
  frame()
  assert.equal(control.style.transform, 'translateY(-0px)')
  assert.equal(classes.has('ticket-controls-hidden'), false)
  ticketRoot.scrollTop = 80
  onScroll()
  frame()
  assert.equal(control.style.transform, 'translateY(-64px)')
  assert.equal(classes.has('ticket-controls-hidden'), true)
})

test('rapid ticket and history taps create only the most recently requested screen', async () => {
  for (const name of ['main', 'auxiliar', 'estilistas', 'manicuristas', 'juan-pablo']) {
    const html = await readFile(path.join(root, 'htmls', name + '.html'), 'utf8')
    const start = html.indexOf('    async function openTickets(')
    const end = html.indexOf('\n    }', start) + 6
    const reads = [], mounted = []
    const context = {
      navigationVersion: 0, ticketWorkspace: '', localStorage: {ready: Promise.resolve()},
      document: {querySelector: () => null, body: {append: el => mounted.push(el)}},
      ticketPage: () => ({view: context.ticketWorkspace}), launcher: {}, renderTickets() {},
      syncPageScrollLock() {}, syncTicketAppearance() {}, setInterval() {},
      refreshWorkersFromServer: () => new Promise(resolve => reads.push(resolve))
    }
    runInNewContext(html.slice(start, end), context)
    const first = context.openTickets('tickets')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reads.length, 1)
    const last = context.openTickets('history')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reads.length, 2)
    reads[1](); await last
    reads[0](); await first
    assert.deepEqual(mounted.map(el => el.view), ['history'], name)
  }
})

test('inactive non-board views return to Tablero after the selected time, defaulting to 30 seconds', async () => {
  const html = await readFile(path.join(root, 'htmls', 'main.html'), 'utf8')
  const settingStart = html.indexOf('    const IDLE_BOARD_SECONDS_KEY =')
  const settingEnd = html.indexOf('    const appearanceSource =', settingStart)
  const timerStart = html.indexOf('    let lastNonBoardInteraction =', settingEnd)
  const timerEnd = html.indexOf('    function syncTicketAppearance', timerStart)
  assert.ok(settingStart > 0 && settingEnd > settingStart && timerStart > settingEnd && timerEnd > timerStart)
  let now = 0
  let nonBoard = false
  let selectedSeconds = null
  let ticks
  let boardClicks = 0
  const handlers = new Map()
  const context = {
    Date: {now: () => now},
    localStorage: {ready: Promise.resolve(), setItem: async () => true},
    getServiceSpecialties: () => ({__boardIdleSeconds: selectedSeconds}),
    document: {
      querySelector: selector => {
        if (selector === '.salon-app .app-controls .appearance-panel') return null
        if (selector === '.pt-modal-backdrop') return null
        assert.equal(selector, '#paper-tickets, #paper-prices, .salon-app.team-page')
        return nonBoard ? {} : null
      },
      addEventListener: (event, handler) => handlers.set(event, handler)
    },
    tableroLauncher: {click: () => {boardClicks++; nonBoard = false}},
    setInterval: callback => {ticks = callback}
  }
  runInNewContext(html.slice(settingStart, settingEnd) + '\nglobalThis.readIdleSeconds = idleBoardSeconds;', context)
  assert.equal(context.readIdleSeconds(), 30)
  runInNewContext(html.slice(timerStart, timerEnd), {...context, idleBoardSeconds: context.readIdleSeconds})
  now = 200000
  ticks()
  assert.equal(boardClicks, 0)
  nonBoard = true
  ticks()
  now += 29000
  ticks()
  assert.equal(boardClicks, 0)
  handlers.get('pointerdown')()
  now += 29000
  ticks()
  assert.equal(boardClicks, 0)
  now += 1000
  ticks()
  assert.equal(boardClicks, 1)
  ticks()
  selectedSeconds = '60'
  assert.equal(context.readIdleSeconds(), 60)
  nonBoard = true
  ticks()
  now += 59000
  ticks()
  assert.equal(boardClicks, 1)
  now += 1000
  ticks()
  assert.equal(boardClicks, 2)
  for (const view of ['main', 'auxiliar', 'manicuristas', 'estilistas']) {
    const page = await readFile(path.join(root, 'htmls', `${view}.html`), 'utf8')
    assert.match(page, /data-idle-board-seconds aria-label="Tiempo para volver al tablero"/, view)
    assert.match(page, /Date\.now\(\) - lastNonBoardInteraction >= idleBoardSeconds\(\) \* 1000/, view)
  }
})
