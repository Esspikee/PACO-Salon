import http from 'node:http'
import {spawn} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {copyFile, mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const clone = value => structuredClone(value)
const json = value => JSON.stringify(value)

class HttpError extends Error {
  constructor(status, message) {super(message); this.status = status}
}

function validateSchedule(value) {
  if (value === undefined || value === null) return undefined
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  if (!value || !Array.isArray(value.days) || value.days.length > 7 || value.days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(value.days).size !== value.days.length || typeof value.start !== 'string' || typeof value.end !== 'string' || !time.test(value.start) || !time.test(value.end) || value.start === value.end) throw new HttpError(400, 'Revisa los días y las horas. La entrada y la salida deben ser diferentes.')
  return {days: [...value.days], start: value.start, end: value.end}
}

function validateBackup(value) {
  if (!value || value.format !== 'salon-queue' || value.schema !== 1 || !Array.isArray(value.workers) || value.workers.length > 100) throw new HttpError(400, 'No es una copia válida del tablero.')
  const ids = new Set()
  const workers = value.workers.map(worker => {
    if (!worker || typeof worker.id !== 'string' || !worker.id || worker.id.length > 100 || ids.has(worker.id) || typeof worker.name !== 'string' || !worker.name.trim() || worker.name.length > 80 || !['MANICURISTA', 'ESTILISTA', 'AUXILIAR'].includes(worker.specialty) || typeof worker.active !== 'boolean') throw new HttpError(400, 'La copia contiene personas o identificadores inválidos.')
    if (worker.disabledOn !== undefined && (typeof worker.disabledOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(worker.disabledOn) || !Number.isFinite(Date.parse(worker.disabledOn + 'T12:00:00')))) throw new HttpError(400, 'La copia contiene una fecha inválida.')
    ids.add(worker.id)
    return {id: worker.id, name: worker.name.trim(), specialty: worker.specialty, active: worker.specialty === 'AUXILIAR' ? false : worker.active, schedule: validateSchedule(worker.schedule), disabledOn: worker.disabledOn}
  })
  return {format: 'salon-queue', schema: 1, version: Number.isSafeInteger(value.version) && value.version > 0 ? value.version : 1, workers}
}

function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isOnSchedule(person, now = new Date()) {
  if (person.specialty === 'AUXILIAR' || !person.active || person.disabledOn === localDay(now)) return false
  const schedule = person.schedule
  if (!schedule) return true
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const current = now.getHours() * 60 + now.getMinutes(), start = minutes(schedule.start), end = minutes(schedule.end)
  if (start < end) return schedule.days.includes(now.getDay()) && current >= start && current < end
  return (schedule.days.includes(now.getDay()) && current >= start) || (schedule.days.includes((now.getDay() + 6) % 7) && current < end)
}

export class SalonStore {
  constructor({dataDirectory, seedPath}) {
    this.dataDirectory = dataDirectory
    this.seedPath = seedPath
    this.statePath = path.join(dataDirectory, 'tablero.json')
    this.recoveredFromBackup = false
    this.state = null
    this.undo = []
    this.operations = new Set()
  }

  async initialize() {
    await mkdir(this.dataDirectory, {recursive: true})
    try {
      this.state = validateBackup(JSON.parse(await readFile(this.statePath, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const seed = JSON.parse(await readFile(this.seedPath, 'utf8'))
        this.state = validateBackup(Array.isArray(seed) ? {format: 'salon-queue', schema: 1, version: 1, workers: seed} : seed)
        await this.persist(this.state)
      } else {
        try {this.state = validateBackup(JSON.parse(await readFile(this.statePath + '.bak', 'utf8')))}
        catch {throw new Error(`No se pudo leer ${this.statePath}: ${error.message}`)}
        this.recoveredFromBackup = true
        console.warn(`Se recuperó el tablero desde ${this.statePath}.bak; revisa los cambios recientes.`)
      }
    }
  }

  snapshot() {
    return {...clone(this.state), can_undo: this.undo.length > 0, undo_label: this.undo.at(-1)?.label || null}
  }

  backup() {return clone(this.state)}

  async persist(state) {
    const temporary = this.statePath + '.tmp'
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8')
    if (!this.recoveredFromBackup) {
      try {await copyFile(this.statePath, this.statePath + '.bak')}
      catch (error) {if (error.code !== 'ENOENT') throw error}
    }
    try {await rename(temporary, this.statePath)}
    catch (error) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error
      await copyFile(temporary, this.statePath)
      await rm(temporary, {force: true})
    }
    this.recoveredFromBackup = false
  }

  async apply(body) {
    if (!body || typeof body !== 'object' || typeof body.action !== 'string') throw new HttpError(400, 'Acción inválida.')
    if (typeof body.operation_id === 'string' && this.operations.has(body.operation_id)) return this.snapshot()
    if (body.version !== this.state.version) throw new HttpError(409, 'La fila cambió en otra pantalla. Ya se actualizó; repite la acción si todavía hace falta.')

    const previousWorkers = clone(this.state.workers)
    const nextUndo = clone(this.undo)
    let workers = clone(this.state.workers), label = ''
    if (body.action === 'undo') {
      if (!nextUndo.length) return this.snapshot()
      workers = nextUndo.pop().workers
    } else if (body.action === 'import') {
      workers = validateBackup(body.backup).workers
      label = 'Importar copia del equipo'
    } else if (body.action === 'delete') {
      const person = workers.find(worker => worker.id === body.worker_id)
      if (!person) throw new HttpError(404, 'Persona no encontrada.')
      workers = workers.filter(worker => worker.id !== person.id)
      label = 'Eliminar a ' + person.name
    } else if (body.action === 'disable' || body.action === 'enable') {
      const person = workers.find(worker => worker.id === body.worker_id)
      if (!person) throw new HttpError(404, 'Persona no encontrada.')
      if (body.action === 'disable') {
        if (!isOnSchedule(person)) throw new HttpError(400, 'La persona no está en la fila.')
        person.disabledOn = localDay()
        label = 'Deshabilitar a ' + person.name + ' por hoy'
      } else {
        delete person.disabledOn
        label = 'Habilitar a ' + person.name
      }
    } else if (body.action === 'reorder') {
      const now = new Date()
      const person = workers.find(worker => worker.id === body.worker_id && isOnSchedule(worker, now))
      const target = workers.find(worker => worker.id === body.target_worker_id && isOnSchedule(worker, now))
      if (!person || !target || person.specialty !== target.specialty || person.id === target.id || !['before', 'after'].includes(body.placement)) throw new HttpError(400, 'No se pudo cambiar esa posición en la fila.')
      workers = workers.filter(worker => worker.id !== person.id)
      const targetIndex = workers.findIndex(worker => worker.id === target.id)
      workers.splice(targetIndex + (body.placement === 'after' ? 1 : 0), 0, person)
      if (workers.every((worker, index) => worker.id === previousWorkers[index].id)) return this.snapshot()
      label = 'Mover a ' + person.name + ' en la fila'
    } else if (body.action === 'rotate') {
      const now = new Date()
      const person = workers.find(worker => worker.id === body.worker_id && isOnSchedule(worker, now))
      if (!person) throw new HttpError(400, 'La persona no está en la fila.')
      if (workers.filter(worker => worker.specialty === person.specialty && isOnSchedule(worker, now)).at(-1)?.id === person.id) return this.snapshot()
      workers = workers.filter(worker => worker.id !== person.id)
      workers.push(person)
      label = 'Mover a ' + person.name + ' al final'
    } else if (body.action === 'save') {
      const schedule = validateSchedule(body.schedule)
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80 || !['MANICURISTA', 'ESTILISTA', 'AUXILIAR'].includes(body.specialty) || typeof body.active !== 'boolean') throw new HttpError(400, 'Completa el nombre y la especialidad.')
      if (body.specialty === 'AUXILIAR') body = {...body, active: false}
      if (body.worker_id) {
        const person = workers.find(worker => worker.id === body.worker_id)
        if (!person) throw new HttpError(404, 'Persona no encontrada.')
        const wasVisible = person.active && person.disabledOn !== localDay()
        if (person.specialty !== body.specialty || (!person.active && body.active)) {
          workers = workers.filter(worker => worker.id !== person.id)
          workers.push(person)
        }
        Object.assign(person, {name: body.name.trim(), specialty: body.specialty, active: body.active, schedule})
        if (body.active) delete person.disabledOn
        label = wasVisible === body.active ? 'Editar a ' + body.name.trim() : (body.active ? 'Mostrar a ' : 'Ocultar a ') + body.name.trim() + ' en el tablero'
      } else {
        if (workers.length >= 100) throw new HttpError(400, 'El equipo admite hasta 100 personas.')
        workers.push({id: randomUUID(), name: body.name.trim(), specialty: body.specialty, active: body.active, schedule})
        label = 'Añadir a ' + body.name.trim()
      }
    } else {
      throw new HttpError(400, 'Acción no disponible.')
    }

    if (body.action !== 'undo') {
      nextUndo.push({workers: previousWorkers, label})
      if (nextUndo.length > 30) nextUndo.splice(0, nextUndo.length - 30)
    }
    const nextState = {...this.state, version: this.state.version + 1, workers}
    await this.persist(nextState)
    this.state = nextState
    this.undo = nextUndo
    const result = this.snapshot()
    if (typeof body.operation_id === 'string' && body.operation_id.length <= 100) {
      this.operations.add(body.operation_id)
      if (this.operations.size > 200) this.operations.delete(this.operations.keys().next().value)
    }
    return result
  }
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new HttpError(413, 'La solicitud es demasiado grande.')
    chunks.push(chunk)
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  catch {throw new HttpError(400, 'El contenido enviado no es JSON válido.')}
}

function sendJson(response, status, value) {
  const body = json(value)
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'})
  response.end(body)
}

export async function createSalonServer(options = {}) {
  const publicDirectory = options.publicDirectory || path.join(here, 'htmls')
  const dataDirectory = options.dataDirectory || process.env.SALON_DATA_DIR || path.join(here, 'data')
  const seedPath = options.seedPath || path.join(here, 'initial-team.json')
  const store = new SalonStore({dataDirectory, seedPath})
  await store.initialize()
  const ticketPath = path.join(dataDirectory, 'tickets.json')
  let ticketState
  let ticketsRecoveredFromBackup = false
  try {ticketState = JSON.parse(await readFile(ticketPath, 'utf8'))}
  catch (error) {
    if (error.code === 'ENOENT') ticketState = {tickets: [], nextTicketNumber: 0, settings: {}}
    else {
      try {ticketState = JSON.parse(await readFile(ticketPath + '.bak', 'utf8'))}
      catch {throw new Error(`No se pudo leer ${ticketPath}: ${error.message}`)}
      ticketsRecoveredFromBackup = true
      console.warn(`Se recuperaron los tickets desde ${ticketPath}.bak; revisa los cambios recientes.`)
    }
  }
  if (!Array.isArray(ticketState.tickets) || !Number.isSafeInteger(ticketState.nextTicketNumber) || !ticketState.settings || typeof ticketState.settings !== 'object') throw new Error(`No se pudo leer ${ticketPath}: datos inválidos.`)
  const ticketSnapshot = () => clone(ticketState)
  const backupsDirectory = options.backupsDirectory || (options.dataDirectory ? path.join(dataDirectory, 'backups') : path.join(here, 'backups'))
  const backupIntervalMs = options.backupIntervalMs || 30 * 60 * 1000
  const backupSources = options.backupSources !== false
  let backupInFlight = null
  const backupNow = () => {
    if (backupInFlight) return backupInFlight
    const board = store.backup()
    const tickets = ticketSnapshot()
    backupInFlight = (async () => {
      const root = path.resolve(backupsDirectory)
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
      const staging = path.resolve(root, `.tmp-${name}`)
      const destination = path.resolve(root, name)
      if (path.dirname(staging) !== root || path.dirname(destination) !== root) throw new Error('Ruta de respaldo inválida.')
      await mkdir(root, {recursive: true})
      await mkdir(staging)
      try {
        await Promise.all([
          writeFile(path.join(staging, 'tablero.json'), JSON.stringify(board, null, 2) + '\n', 'utf8'),
          writeFile(path.join(staging, 'tickets.json'), JSON.stringify(tickets, null, 2) + '\n', 'utf8'),
          writeFile(path.join(staging, 'manifest.json'), JSON.stringify({format: 'salon-backup', createdAt: new Date().toISOString(), employeeCount: board.workers.length, ticketLineCount: tickets.tickets.length, sourceArchive: backupSources ? 'source.tar.gz' : null}, null, 2) + '\n', 'utf8')
        ])
        if (backupSources) {
          const entries = (await readdir(here)).filter(name => !['.git', 'data', 'backups', 'runtime'].includes(name) && !name.endsWith('.log'))
          await new Promise((resolve, reject) => {
            const archive = spawn('tar', ['-czf', path.join(staging, 'source.tar.gz'), ...entries.map(name => './' + name)], {cwd: here, windowsHide: true, stdio: 'ignore'})
            archive.on('error', reject)
            archive.on('close', code => code === 0 ? resolve() : reject(new Error(`No se pudo comprimir el proyecto (${code}).`)))
          })
        }
        await rename(staging, destination)
        return destination
      } catch (error) {
        await rm(staging, {recursive: true, force: true})
        throw error
      }
    })().finally(() => {backupInFlight = null})
    return backupInFlight
  }
  const ticketSettings = new Set(['salon-service-prices-v1', 'salon-custom-services-v1', 'salon-deleted-services-v1', 'salon-color-supplies-v1', 'salon-service-specialties-v1'])
  const saveTicketState = async next => {
    const temporary = ticketPath + '.tmp'
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8')
    if (!ticketsRecoveredFromBackup) {
      try {await copyFile(ticketPath, ticketPath + '.bak')}
      catch (error) {if (error.code !== 'ENOENT') throw error}
    }
    try {await rename(temporary, ticketPath)}
    catch (error) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error
      await copyFile(temporary, ticketPath)
      await rm(temporary, {force: true})
    }
    ticketsRecoveredFromBackup = false
    ticketState = next
  }
  const updateTickets = async body => {
    if (!body || !['changes', 'migrate'].includes(body.action) || !Array.isArray(body.upsert) || body.upsert.length > 500 || !Array.isArray(body.deleteIds) || body.deleteIds.length > 500 || !body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) throw new HttpError(400, 'Cambio de tickets inválido.')
    if (body.activity !== undefined && (body.action !== 'changes' || !body.activity || !['open', 'finalized'].includes(body.activity.status) || typeof body.activity.workerName !== 'string' || !body.activity.workerName.trim() || body.activity.workerName.length > 80 || typeof body.activity.groupId !== 'string' || !body.upsert.some(ticket => ticket?.ticketGroupId === body.activity.groupId && ticket.ticketStatus === body.activity.status))) throw new HttpError(400, 'Actividad de ticket inválida.')
    const next = ticketSnapshot()
    const byId = new Map(next.tickets.map(ticket => [ticket.id, ticket]))
    const touched = new Set(Object.keys(body.settings).map(key => 'setting:' + key))
    const revisions = next.revisions ||= {}
    if (body.operationId !== undefined && (typeof body.operationId !== 'string' || !body.operationId || body.operationId.length > 100)) throw new HttpError(400, 'Identificador de operación inválido.')
    if (body.expected !== undefined) {
      if (!body.expected || typeof body.expected !== 'object' || Array.isArray(body.expected)) throw new HttpError(400, 'Versiones de ticket inválidas.')
      for (const [key, version] of Object.entries(body.expected)) {
        if ((revisions[key] || 0) !== version) throw new HttpError(409, 'Otra pantalla cambió este ticket o ajuste. Revisa la versión actualizada antes de volver a guardar.')
      }
    }
    if (body.action === 'changes') for (const id of body.deleteIds) {
      if (typeof id !== 'string') throw new HttpError(400, 'Identificador inválido.')
      if (byId.has(id)) touched.add('group:' + byId.get(id).ticketGroupId)
      byId.delete(id)
    }
    const groupNumbers = new Map()
    for (const ticket of next.tickets) if (ticket.ticketGroupId && Number.isSafeInteger(ticket.ticketNumber)) groupNumbers.set(ticket.ticketGroupId, ticket.ticketNumber)
    for (const ticket of body.upsert) {
      if (!ticket || typeof ticket.id !== 'string' || !ticket.id || ticket.id.length > 100 || typeof ticket.ticketGroupId !== 'string' || !ticket.ticketGroupId || typeof ticket.workerName !== 'string' || typeof ticket.serviceName !== 'string' || !Number.isSafeInteger(ticket.amount) || ticket.amount < 0 || ticket.amount > 10_000_000) throw new HttpError(400, 'El ticket contiene datos inválidos.')
      if (body.action === 'migrate' && byId.has(ticket.id)) continue
      touched.add('group:' + ticket.ticketGroupId)
      const copy = clone(ticket)
      let number = groupNumbers.get(copy.ticketGroupId)
      if (number === undefined) {
        number = next.nextTicketNumber++
        groupNumbers.set(copy.ticketGroupId, number)
      }
      copy.ticketNumber = number
      byId.set(copy.id, copy)
    }
    if (body.action === 'changes') {
      const groupUpdates = new Map()
      for (const ticket of body.upsert) {
        const update = groupUpdates.get(ticket.ticketGroupId) || {}
        if (ticket.ticketStatus === 'open' || ticket.ticketStatus === 'finalized') {
          update.status = ticket.ticketStatus
          update.closedAt = ticket.closedAt
        }
        if (Array.isArray(ticket.openAssignedWorkers) && ticket.openAssignedWorkers.length) {
          if (ticket.openAssignedWorkers.length > 100 || ticket.openAssignedWorkers.some(worker => !worker || typeof worker.code !== 'string' || !worker.code || typeof worker.name !== 'string' || !worker.name || !['MANICURISTA', 'ESTILISTA', 'AUXILIAR'].includes(worker.specialty))) throw new HttpError(400, 'Asignación de ticket inválida.')
          update.assignment = {workers: ticket.openAssignedWorkers.map(worker => ({code: worker.code, name: worker.name, specialty: worker.specialty}))}
        } else if (typeof ticket.openAssignedWorkerCode === 'string' && ticket.openAssignedWorkerCode && typeof ticket.openAssignedWorkerName === 'string' && ticket.openAssignedWorkerName) {
          update.assignment = {code: ticket.openAssignedWorkerCode, name: ticket.openAssignedWorkerName, specialty: ticket.openAssignedWorkerSpecialty}
        }
        groupUpdates.set(ticket.ticketGroupId, update)
      }
      for (const [groupId, update] of groupUpdates) {
        for (const ticket of byId.values()) {
          if (ticket.ticketGroupId !== groupId) continue
          if (update.status) {
            const statusChanged = ticket.ticketStatus !== update.status
            ticket.ticketStatus = update.status
            if (update.status === 'open') {ticket.closedAt = null; ticket.enteredAt = null; ticket.exportedAt = null}
            else if (statusChanged || update.closedAt) ticket.closedAt = update.closedAt || new Date().toISOString()
          }
          if (update.assignment) {
            const first = update.assignment.workers?.[0] || update.assignment
            ticket.openAssignedWorkerCode = first.code
            ticket.openAssignedWorkerName = first.name
            ticket.openAssignedWorkerSpecialty = first.specialty
            if (update.assignment.workers) ticket.openAssignedWorkers = clone(update.assignment.workers)
            else delete ticket.openAssignedWorkers
          }
        }
      }
    }
    next.tickets = [...byId.values()]
    for (const [key, value] of Object.entries(body.settings)) {
      if (!ticketSettings.has(key) || typeof value !== 'string' || value.length > 100_000) throw new HttpError(400, 'Ajuste de tickets inválido.')
      try {JSON.parse(value)} catch {throw new HttpError(400, 'Ajuste de tickets inválido.')}
      if (body.action !== 'migrate' || next.settings[key] === undefined) next.settings[key] = value
    }
    for (const key of touched) revisions[key] = (revisions[key] || 0) + 1
    if (body.operationId) next.recentOperations = [...(next.recentOperations || []), body.operationId].slice(-256)
    await saveTicketState(next)
    return ticketSnapshot()
  }
  const eventClients = new Set()
  let mutation = Promise.resolve()

  const notify = () => {
    const message = `event: board\ndata: ${store.state.version}\n\n`
    for (const response of eventClients) response.write(message)
  }
  const notifyTickets = () => {
    for (const response of eventClients) response.write('event: tickets\ndata: updated\n\n')
  }
  const notifyTicketActivity = activity => {
    if (!activity) return
    const lines = activity.status === 'finalized' ? ticketState.tickets.filter(ticket => ticket.ticketGroupId === activity.groupId && ticket.ticketStatus === 'finalized') : []
    const ticket = lines.length ? {
      groupId: activity.groupId,
      revision: ticketState.revisions['group:' + activity.groupId],
      closedAt: lines[0].closedAt,
      ticketNumber: lines[0].ticketNumber,
      customerName: lines[0].customerName || 'Cliente',
      customerLastName: lines[0].customerLastName || '',
      services: lines.map(line => ({serviceName: line.serviceName, productName: line.productName || '', workerName: line.workerName, amount: line.amount})),
      total: lines.reduce((sum, line) => sum + line.amount, 0)
    } : undefined
    const message = `event: ticket-activity\ndata: ${json({id: randomUUID(), status: activity.status, workerName: activity.workerName.trim(), ...(ticket ? {ticket} : {})})}\n\n`
    for (const response of eventClients) response.write(message)
  }
  const routes = new Map([
    ['/', 'main.html'], ['/main', 'main.html'], ['/main.html', 'main.html'],
    ['/auxiliar', 'auxiliar.html'], ['/auxiliar.html', 'auxiliar.html'],
    ['/manicuristas', 'manicuristas.html'], ['/manicuristas.html', 'manicuristas.html'],
    ['/estilistas', 'estilistas.html'], ['/estilistas.html', 'estilistas.html'], ['/Estilistas.html', 'estilistas.html'],
    ['/juan-pablo', 'juan-pablo-2.0.html'], ['/juan-pablo.html', 'juan-pablo-2.0.html'],
    ['/juan-pablo-2.0', 'juan-pablo-2.0.html'], ['/juan-pablo-2.0.html', 'juan-pablo-2.0.html'],
    ['/william', 'william.html'], ['/william.html', 'william.html'],
  ])

  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://salon.local').pathname
      if (request.method === 'GET' && pathname === '/health') return sendJson(response, 200, {ok: true, version: store.state.version, connected_tablets: eventClients.size, server_time: new Date().toISOString()})
      if (request.method === 'GET' && pathname === '/board') return sendJson(response, 200, store.snapshot())
      if (request.method === 'GET' && pathname === '/ticket-state') return sendJson(response, 200, ticketSnapshot())
      if (request.method === 'POST' && pathname === '/ticket-state') {
        const body = await readBody(request)
        const result = await new Promise((resolve, reject) => {mutation = mutation.then(() => updateTickets(body)).then(resolve, reject)})
        sendJson(response, 200, result)
        notifyTickets()
        notifyTicketActivity(body.activity)
        return
      }
      if (request.method === 'GET' && pathname === '/ticket-storage.js') {
        const body = await readFile(path.join(here, 'ticket-storage.js'))
        response.writeHead(200, {'content-type': 'text/javascript; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'})
        response.end(body)
        return
      }
      if (request.method === 'GET' && pathname === '/josepp-watermark.png') {
        const body = await readFile(path.join(publicDirectory, 'josepp-watermark.png'))
        response.writeHead(200, {'content-type': 'image/png', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'})
        response.end(body)
        return
      }
      if (request.method === 'GET' && pathname === '/backup') return sendJson(response, 200, store.backup())
      if (request.method === 'GET' && pathname === '/events') {
        response.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no'})
        response.write(`event: board\ndata: ${store.state.version}\n\n`)
        eventClients.add(response)
        request.on('close', () => eventClients.delete(response))
        return
      }
      if (request.method === 'POST' && pathname === '/actions') {
        const body = await readBody(request)
        const result = await new Promise((resolve, reject) => {
          mutation = mutation.then(() => store.apply(body)).then(resolve, reject)
        })
        sendJson(response, 200, result)
        notify()
        return
      }
      if (request.method === 'GET' && routes.has(pathname)) {
        const html = await readFile(path.join(publicDirectory, routes.get(pathname)), 'utf8')
        const ticketScript = await readFile(path.join(here, 'ticket-storage.js'), 'utf8')
        const body = Buffer.from(html.replace('  /* Tickets locales compartidos por las cuatro pantallas HTML. */', `</script><script>${ticketScript}</script><script>\n  /* Tickets compartidos por las cuatro pantallas desde el servidor. */`))
        response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store, no-cache, must-revalidate', pragma: 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'})
        response.end(body)
        return
      }
      sendJson(response, 404, {error: 'Página no encontrada.'})
    } catch (error) {
      if (!error.status || error.status >= 500) console.error(`[${new Date().toISOString()}]`, error)
      sendJson(response, error.status || 500, {error: error.status ? error.message : 'El servidor no pudo completar la operación.'})
    }
  })
  const keepAlive = setInterval(() => {for (const response of eventClients) response.write(': ping\n\n')}, 20_000)
  keepAlive.unref()
  server.on('close', () => clearInterval(keepAlive))
  await backupNow()
  const backupTimer = setInterval(() => {void backupNow().catch(error => console.error('No se pudo crear el respaldo automático:', error))}, backupIntervalMs)
  backupTimer.unref()
  server.on('close', () => clearInterval(backupTimer))
  return {server, store, backupNow, backupsDirectory}
}

function networkAddresses(port) {
  const addresses = []
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) addresses.push(`http://${entry.address}:${port}`)
  return [...new Set(addresses)]
}

function printAccessLinks(port) {
  console.log(`Panel principal: http://localhost:${port}/main`)
  for (const address of networkAddresses(port)) {
    console.log(`\nEn las tablets usando ${address}:`)
    console.log(`  Principal:    ${address}/main`)
    console.log(`  Auxiliar:     ${address}/auxiliar`)
    console.log(`  Manicuristas: ${address}/manicuristas`)
    console.log(`  Estilistas:   ${address}/estilistas`)
    console.log(`  Juan Pablo:   ${address}/juan-pablo-2.0`)
    console.log(`  William:      ${address}/william`)
  }
}

export async function startSalonServer({host = process.env.HOST || '0.0.0.0', port = Number(process.env.PORT || 8080)} = {}) {
  const {server, store} = await createSalonServer()
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, host, resolve)})
  const actualPort = server.address().port
  console.log('\nJOSEPP · Servidor de turnos activo')
  console.log(`Datos: ${store.statePath}`)
  printAccessLinks(actualPort)
  console.log('\nMantén esta ventana abierta. Presiona Ctrl+C para apagar el servidor.\n')
  return {server, store}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startSalonServer().then(({server}) => {
    if (process.platform === 'win32' && process.env.SALON_OPEN_BROWSER === '1') {
      const url = `http://localhost:${server.address().port}/main`
      const browser = spawn('explorer.exe', [url], {stdio: 'ignore', windowsHide: true})
      browser.on('error', () => console.error(`Abre el panel en ${url}`))
      browser.unref()
    }
  }).catch(error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`El puerto ${process.env.PORT || 8080} ya está en uso. El servidor puede estar abierto en otra ventana.`)
      printAccessLinks(Number(process.env.PORT || 8080))
    }
    else console.error('No se pudo iniciar el servidor:', error.message)
    process.exitCode = 1
  })
}
