// Pruebas de la lógica de carga masiva de CV.  Correr con:  node --test src/pages/ImportacionMasiva/cvImport.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXTENSIONES_CV, ACCEPT_CV, MB, extension, formatearTamanio, clasificarArchivos,
  dividirEnLotes, resumen, construirFormData, mensajeDeError, marcarDuplicados, procesarEnLotes,
} from './cvImport.js'

const archivo = (name, size = 1000, lastModified = 1) => ({ name, size, lastModified })

// ── formatos y tamaños ───────────────────────────────────────
test('acepta los 7 formatos pedidos (y jpeg/htm)', () => {
  for (const e of ['pdf', 'docx', 'png', 'jpg', 'html', 'md', 'txt', 'jpeg', 'htm']) {
    assert.ok(EXTENSIONES_CV.includes(e), e)
  }
  assert.ok(ACCEPT_CV.includes('.docx') && ACCEPT_CV.startsWith('.pdf'))
})

test('extension en mayúsculas, sin punto y con varios puntos', () => {
  assert.equal(extension('CV.PDF'), 'pdf')
  assert.equal(extension('mi.hoja.de.vida.docx'), 'docx')
  assert.equal(extension('sinextension'), '')
})

test('formatearTamanio', () => {
  assert.equal(formatearTamanio(500), '500 B')
  assert.equal(formatearTamanio(2048), '2.0 KB')
  assert.equal(formatearTamanio(3 * MB), '3.0 MB')
})

// ── clasificar lo que se arrastra ───────────────────────────
test('clasifica aceptados y rechazados con su motivo', () => {
  const { aceptados, rechazados } = clasificarArchivos([
    archivo('a.pdf'), archivo('b.exe'), archivo('c.txt', 0), archivo('d.png', 11 * MB), archivo('e.MD'),
  ])
  assert.deepEqual(aceptados.map(i => i.nombre), ['a.pdf', 'e.MD'])
  assert.deepEqual(rechazados.map(r => r.motivo),
    ['formato no permitido', 'el archivo está vacío', 'supera 10 MB'])
  assert.ok(aceptados.every(i => i.estado === 'PENDIENTE' && i.id))
})

test('no agrega dos veces el mismo archivo, pero sí el mismo nombre con otro contenido', () => {
  const primero = clasificarArchivos([archivo('cv.pdf', 100, 5)])
  const segundo = clasificarArchivos(
    [archivo('cv.pdf', 100, 5), archivo('cv.pdf', 200, 5)], primero.aceptados)
  assert.equal(segundo.aceptados.length, 1)
  assert.equal(segundo.rechazados[0].motivo, 'ya estaba en la lista')
})

test('respeta el tope total y el tamaño máximo que dice el backend', () => {
  const r = clasificarArchivos([archivo('1.pdf'), archivo('2.pdf'), archivo('3.pdf')], [], { maxTotal: 2 })
  assert.equal(r.aceptados.length, 2)
  assert.match(r.rechazados[0].motivo, /máximo 2/)
  const g = clasificarArchivos([archivo('x.pdf', 3 * MB)], [], { maxBytes: 2 * MB })
  assert.equal(g.rechazados[0].motivo, 'supera 2 MB')
})

test('dividirEnLotes', () => {
  assert.deepEqual(dividirEnLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(dividirEnLotes([], 3), [])
  assert.deepEqual(dividirEnLotes([1, 2], 0), [[1], [2]])
})

// ── FormData ─────────────────────────────────────────────────
test('construirFormData manda el campo "archivos" repetido y las banderas como texto', () => {
  const a = new Blob(['x']), b = new Blob(['y'])
  const fd = construirFormData([a, b], { dryRun: true, omitirErrores: false, usuarioId: 7 })
  assert.equal(fd.getAll('archivos').length, 2)
  assert.equal(fd.get('dry_run'), 'true')
  assert.equal(fd.get('omitir_errores'), 'false')
  assert.equal(fd.get('usuario_id'), '7')
})

test('construirFormData: omitir_errores es true por defecto y sin usuario no manda usuario_id', () => {
  const fd = construirFormData([new Blob(['x'])], { dryRun: false })
  assert.equal(fd.get('omitir_errores'), 'true')
  assert.equal(fd.has('usuario_id'), false)
})

test('mensajeDeError', () => {
  assert.equal(mensajeDeError({ response: { data: { error: 'malo' } } }), 'malo')
  assert.equal(mensajeDeError({ code: 'ECONNABORTED' }), 'El servidor tardó demasiado en responder.')
  assert.equal(mensajeDeError({ request: {} }), 'No se pudo conectar con el servidor.')
  assert.equal(mensajeDeError({}, 'por defecto'), 'por defecto')
})

// ── duplicados entre lotes ───────────────────────────────────
const conDatos = (nombre, datos, estado = 'OK') => ({ id: nombre, nombre, estado, datos, mensaje: '' })

test('marcarDuplicados deja el primero y marca los demás (correo sin importar mayúsculas)', () => {
  const r = marcarDuplicados([
    conDatos('a.pdf', { email: 'Ana@x.com' }),
    conDatos('b.pdf', { email: 'ana@x.com' }),
    conDatos('c.pdf', { email: 'otra@x.com' }),
  ])
  assert.deepEqual(r.map(i => i.estado), ['OK', 'ERROR', 'OK'])
  assert.match(r[1].mensaje, /mismo correo que 'a.pdf'/)
})

test('marcarDuplicados por tipo+número de documento y sin tocar los que ya son error', () => {
  const r = marcarDuplicados([
    conDatos('a.pdf', { email: 'a@x.com', tipo_documento: 'Cédula de Ciudadanía', numero_documento: '1' }),
    conDatos('b.pdf', { email: 'b@x.com', tipo_documento: 'Cédula de Ciudadanía', numero_documento: '1' }),
    conDatos('c.pdf', { email: 'a@x.com' }, 'ERROR'),
  ])
  assert.deepEqual(r.map(i => i.estado), ['OK', 'ERROR', 'ERROR'])
  assert.match(r[1].mensaje, /mismo documento/)
})

// ── procesarEnLotes ──────────────────────────────────────────
const items = n => clasificarArchivos(
  Array.from({ length: n }, (_, i) => archivo(`cv${i + 1}.pdf`, 100, i))).aceptados

// Backend de mentira: el correo es cvN@x.com; el archivo "malo" falla.
const backendFalso = (llamadas = []) => async (archivos, op) => {
  llamadas.push({ n: archivos.length, ...op })
  const log = archivos.map((f, i) => f.name.includes('malo')
    ? { fila: i + 1, archivo: f.name, estado: 'ERROR', mensaje: 'No se encontró un correo', datos: null, advertencias: [] }
    : {
      fila: i + 1, archivo: f.name, estado: 'OK', mensaje: 'ok', advertencias: ['revisar'],
      datos: { email: `${f.name.replace('.pdf', '')}@x.com`, primer_nombre: 'A', primer_apellido: 'B' },
      ...(op.dryRun ? {} : { candidato_id: 100 + i }),
    })
  return { status: op.dryRun ? 200 : 201, data: { log } }
}

test('analiza en lotes, une los resultados en el orden original y reporta progreso', async () => {
  const llamadas = [], progreso = []
  const lista = items(25)
  const r = await procesarEnLotes({
    items: lista, enviar: backendFalso(llamadas), dryRun: true, tamLote: 10,
    onProgreso: p => progreso.push(p.hechos),
  })
  assert.deepEqual(llamadas.map(l => l.n), [10, 10, 5])
  assert.deepEqual(r.items.map(i => i.nombre), lista.map(i => i.nombre))
  assert.ok(r.items.every(i => i.estado === 'OK' && i.datos.email.endsWith('@x.com')))
  assert.equal(progreso.at(-1), 25)
  assert.equal(r.fatal, null)
})

test('un archivo malo no afecta a los demás del lote', async () => {
  const lista = clasificarArchivos([archivo('a.pdf', 10, 1), archivo('malo.pdf', 10, 2), archivo('c.pdf', 10, 3)]).aceptados
  const r = await procesarEnLotes({ items: lista, enviar: backendFalso(), dryRun: true })
  assert.deepEqual(r.items.map(i => i.estado), ['OK', 'ERROR', 'OK'])
  assert.deepEqual(resumen(r.items), { total: 3, pendientes: 0, ok: 2, errores: 1, importados: 0, conAvisos: 2 })
})

test('al analizar detecta duplicados entre lotes distintos', async () => {
  const lista = clasificarArchivos([archivo('a.pdf', 10, 1), archivo('a.pdf', 20, 1)]).aceptados
  // los dos archivos se llaman igual => el backend falso les da el mismo correo
  const r = await procesarEnLotes({ items: lista, enviar: backendFalso(), dryRun: true, tamLote: 1 })
  assert.deepEqual(r.items.map(i => i.estado), ['OK', 'ERROR'])
})

test('al importar solo se envían los que pasaron la validación y quedan IMPORTADO', async () => {
  const lista = clasificarArchivos([archivo('a.pdf', 10, 1), archivo('malo.pdf', 10, 2), archivo('c.pdf', 10, 3)]).aceptados
  const analizado = await procesarEnLotes({ items: lista, enviar: backendFalso(), dryRun: true })
  const llamadas = []
  const r = await procesarEnLotes({
    items: analizado.items, enviar: backendFalso(llamadas), dryRun: false,
    seleccion: i => i.estado === 'OK',
  })
  assert.deepEqual(llamadas.map(l => l.n), [2])
  assert.deepEqual(r.items.map(i => i.estado), ['IMPORTADO', 'ERROR', 'IMPORTADO'])
  assert.ok(r.items[0].candidato_id)
  assert.equal(r.items[1].candidato_id, null)
})

test('422 con log: se muestra el detalle por archivo y el mensaje general', async () => {
  const lista = items(2)
  const enviar = async () => {
    const e = new Error('422')
    e.response = { status: 422, data: { error: 'No se importó ningún candidato.', log: [
      { fila: 1, estado: 'ERROR', mensaje: 'Ya existe un candidato con el correo a@x.com.' },
      { fila: 2, estado: 'ERROR', mensaje: 'No se pudo guardar el candidato en la base de datos.' }] } }
    throw e
  }
  const r = await procesarEnLotes({ items: lista, enviar, dryRun: false })
  assert.deepEqual(r.items.map(i => i.estado), ['ERROR', 'ERROR'])
  assert.match(r.items[0].mensaje, /Ya existe/)
  assert.equal(r.avisoServidor, 'No se importó ningún candidato.')
  assert.equal(r.fatal, null)
})

test('503 (modelo apagado) corta todo y deja los archivos pendientes', async () => {
  const llamadas = []
  const enviar = async () => {
    llamadas.push(1)
    const e = new Error('503')
    e.response = { status: 503, data: { error: 'El modelo de IA no está disponible: falta modelo.pt' } }
    throw e
  }
  const r = await procesarEnLotes({ items: items(25), enviar, dryRun: true, tamLote: 10 })
  assert.equal(llamadas.length, 1)
  assert.match(r.fatal, /modelo de IA no está disponible/)
  assert.ok(r.items.every(i => i.estado === 'PENDIENTE'))
})

test('sin conexión en un lote: marca ese lote con error y sigue con el resto', async () => {
  let n = 0
  const enviar = async (archivos, op) => {
    n += 1
    if (n === 1) { const e = new Error('red'); e.request = {}; throw e }
    return backendFalso()(archivos, op)
  }
  const r = await procesarEnLotes({ items: items(4), enviar, dryRun: false, tamLote: 2 })
  assert.deepEqual(r.items.map(i => i.estado), ['ERROR', 'ERROR', 'IMPORTADO', 'IMPORTADO'])
  assert.match(r.items[0].mensaje, /No se pudo conectar.*Revisa en Candidatos/)
})

test('error 500 de un lote no detiene los siguientes', async () => {
  let n = 0
  const enviar = async (archivos, op) => {
    n += 1
    if (n === 1) { const e = new Error('x'); e.response = { status: 500, data: {} }; throw e }
    return backendFalso()(archivos, op)
  }
  const r = await procesarEnLotes({ items: items(4), enviar, dryRun: true, tamLote: 2 })
  assert.deepEqual(r.items.map(i => i.estado), ['ERROR', 'ERROR', 'OK', 'OK'])
  assert.match(r.items[0].mensaje, /Error del servidor \(500\)/)
})

test('cancelar: no envía más lotes y conserva lo ya procesado', async () => {
  const ctrl = new AbortController()
  let n = 0
  const enviar = async (archivos, op) => {
    n += 1
    const res = await backendFalso()(archivos, op)
    if (n === 1) ctrl.abort()
    return res
  }
  const r = await procesarEnLotes({ items: items(6), enviar, dryRun: true, tamLote: 2, signal: ctrl.signal })
  assert.equal(r.cancelado, true)
  assert.equal(n, 1)
  assert.deepEqual(r.items.map(i => i.estado), ['OK', 'OK', 'PENDIENTE', 'PENDIENTE', 'PENDIENTE', 'PENDIENTE'])
})

test('si el servidor no devuelve la fila de un archivo, se marca como error', async () => {
  const enviar = async () => ({ data: { log: [{ fila: 1, estado: 'OK', mensaje: 'ok', datos: {}, advertencias: [] }] } })
  const r = await procesarEnLotes({ items: items(2), enviar, dryRun: true })
  assert.deepEqual(r.items.map(i => i.estado), ['OK', 'ERROR'])
})
