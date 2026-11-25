// Lógica de la carga masiva de hojas de vida (sin React, así se puede probar sola).
// El componente ImportacionCV.jsx solo pinta lo que sale de acá.

export const EXTENSIONES_CV = ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'html', 'htm', 'md', 'txt']
export const ACCEPT_CV = EXTENSIONES_CV.map(e => `.${e}`).join(',')

export const MB = 1024 * 1024
export const MAX_MB_DEFECTO = 10        // el backend dice el real en /cv/estado/
export const MAX_TOTAL_CV = 500         // tope de archivos en pantalla
export const LOTE_CV = 10               // archivos por petición (el OCR tarda, mejor lotes chicos)
export const TIMEOUT_LOTE_MS = 10 * 60 * 1000

let contador = 0

export function extension(nombre = '') {
  const i = nombre.lastIndexOf('.')
  return i < 0 ? '' : nombre.slice(i + 1).toLowerCase()
}

export function formatearTamanio(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

const claveArchivo = f => `${f.name}|${f.size}|${f.lastModified}`

function nuevoItem(file) {
  contador += 1
  return {
    id: `cv-${contador}`,
    file,
    nombre: file.name,
    tamanio: file.size,
    ext: extension(file.name),
    estado: 'PENDIENTE',      // PENDIENTE | OK | ERROR | IMPORTADO
    mensaje: '',
    datos: null,
    advertencias: [],
    candidato_id: null,
  }
}

// Separa lo que se puede subir de lo que no (formato, tamaño, repetidos, tope total).
export function clasificarArchivos(nuevos, actuales = [], opciones = {}) {
  const maxBytes = opciones.maxBytes ?? MAX_MB_DEFECTO * MB
  const maxTotal = opciones.maxTotal ?? MAX_TOTAL_CV
  const vistos = new Set(actuales.map(i => claveArchivo(i.file)))
  const aceptados = []
  const rechazados = []

  for (const file of Array.from(nuevos || [])) {
    if (!EXTENSIONES_CV.includes(extension(file.name))) {
      rechazados.push({ nombre: file.name, motivo: 'formato no permitido' })
    } else if (file.size === 0) {
      rechazados.push({ nombre: file.name, motivo: 'el archivo está vacío' })
    } else if (file.size > maxBytes) {
      rechazados.push({ nombre: file.name, motivo: `supera ${Math.floor(maxBytes / MB)} MB` })
    } else if (vistos.has(claveArchivo(file))) {
      rechazados.push({ nombre: file.name, motivo: 'ya estaba en la lista' })
    } else if (actuales.length + aceptados.length >= maxTotal) {
      rechazados.push({ nombre: file.name, motivo: `máximo ${maxTotal} archivos por carga` })
    } else {
      vistos.add(claveArchivo(file))
      aceptados.push(nuevoItem(file))
    }
  }
  return { aceptados, rechazados }
}

export function dividirEnLotes(lista, tamano) {
  const n = Math.max(1, tamano | 0)
  const lotes = []
  for (let i = 0; i < lista.length; i += n) lotes.push(lista.slice(i, i + n))
  return lotes
}

export function resumen(items) {
  const r = { total: items.length, pendientes: 0, ok: 0, errores: 0, importados: 0, conAvisos: 0 }
  for (const i of items) {
    if (i.estado === 'OK') r.ok += 1
    else if (i.estado === 'ERROR') r.errores += 1
    else if (i.estado === 'IMPORTADO') r.importados += 1
    else r.pendientes += 1
    if (i.advertencias?.length) r.conAvisos += 1
  }
  return r
}

// FormData que espera el backend: campo repetido "archivos" + banderas.
export function construirFormData(archivos, { dryRun, omitirErrores, usuarioId } = {}) {
  const fd = new FormData()
  archivos.forEach(f => fd.append('archivos', f))
  fd.append('dry_run', String(!!dryRun))
  fd.append('omitir_errores', String(omitirErrores !== false))
  if (usuarioId !== undefined && usuarioId !== null && usuarioId !== '') {
    fd.append('usuario_id', String(usuarioId))
  }
  return fd
}

export function mensajeDeError(err, defecto = 'Ocurrió un error inesperado.') {
  const d = err?.response?.data
  if (d?.error) return d.error
  if (typeof d?.detail === 'string') return d.detail
  if (err?.code === 'ECONNABORTED') return 'El servidor tardó demasiado en responder.'
  if (err?.request && !err?.response) return 'No se pudo conectar con el servidor.'
  return defecto
}

const esCancelacion = err =>
  err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError'

// Cuando el backend devuelve el log de un lote, la fila es la posición (desde 1) dentro del lote.
function aplicarLog(lote, log, dryRun) {
  const porFila = new Map((log || []).map(e => [e.fila, e]))
  return lote.map((item, idx) => {
    const e = porFila.get(idx + 1)
    if (!e) {
      return { ...item, estado: 'ERROR', mensaje: 'El servidor no devolvió resultado para este archivo.' }
    }
    const importado = !dryRun && e.candidato_id != null
    return {
      ...item,
      estado: importado ? 'IMPORTADO' : (e.estado === 'OK' ? 'OK' : 'ERROR'),
      mensaje: e.mensaje || '',
      datos: e.datos ?? item.datos,
      advertencias: e.advertencias || [],
      candidato_id: e.candidato_id ?? null,
    }
  })
}

function marcarTodos(lote, mensaje) {
  return lote.map(item => ({ ...item, estado: 'ERROR', mensaje }))
}

// Dos archivos de lotes distintos con el mismo correo o documento: el backend solo ve un lote
// a la vez, así que esto se revisa acá. El primero se queda y los demás pasan a ERROR.
export function marcarDuplicados(items) {
  const correos = new Map()
  const documentos = new Map()
  return items.map(item => {
    if (item.estado !== 'OK' || !item.datos) return item
    const correo = (item.datos.email || '').toLowerCase()
    const doc = item.datos.numero_documento
      ? `${item.datos.tipo_documento || ''}|${item.datos.numero_documento}` : ''
    const previo = (correo && correos.get(correo)) || (doc && documentos.get(doc))
    if (previo) {
      const campo = correo && correos.has(correo) ? 'correo' : 'documento'
      return { ...item, estado: 'ERROR', mensaje: `Duplicado en esta carga: mismo ${campo} que '${previo}'.` }
    }
    if (correo) correos.set(correo, item.nombre)
    if (doc) documentos.set(doc, item.nombre)
    return item
  })
}

/**
 * Manda los archivos al backend por lotes y va actualizando el estado de cada uno.
 *   items   : lista completa (solo se envían los que cumplan `seleccion`)
 *   enviar  : (archivos, { dryRun, omitirErrores, signal }) => Promise<axiosResponse>
 * Devuelve { items, fatal, cancelado, avisoServidor }. `fatal` es un texto cuando no tiene sentido
 * seguir (modelo apagado, compañía inexistente...). `avisoServidor` es el mensaje general de un 422.
 * Lo que no se alcanzó a procesar queda como estaba.
 */
export async function procesarEnLotes({
  items, enviar, dryRun, omitirErrores = true, tamLote = LOTE_CV,
  seleccion = () => true, onProgreso, signal,
}) {
  let actuales = items.slice()
  const objetivo = items.filter(seleccion)
  const lotes = dividirEnLotes(objetivo, tamLote)
  let hechos = 0
  let avisoServidor = null
  const reemplazar = nuevos => {
    const porId = new Map(nuevos.map(n => [n.id, n]))
    actuales = actuales.map(i => porId.get(i.id) || i)
  }

  for (let k = 0; k < lotes.length; k += 1) {
    if (signal?.aborted) return { items: actuales, fatal: null, cancelado: true, avisoServidor }
    const lote = lotes[k]
    onProgreso?.({ hechos, total: objetivo.length, lote: k + 1, lotes: lotes.length })

    let actualizado
    try {
      const res = await enviar(lote.map(i => i.file), { dryRun, omitirErrores, signal })
      actualizado = aplicarLog(lote, res.data?.log, dryRun)
    } catch (err) {
      if (esCancelacion(err) || signal?.aborted) return { items: actuales, fatal: null, cancelado: true, avisoServidor }
      const status = err?.response?.status
      const data = err?.response?.data
      if (status === 422 && Array.isArray(data?.log)) {
        actualizado = aplicarLog(lote, data.log, dryRun)           // todo falló, pero hay detalle por archivo
        avisoServidor = data.error || avisoServidor
      } else if (status === 503 || status === 404 || status === 400) {
        return { items: actuales, fatal: mensajeDeError(err), cancelado: false, avisoServidor }
      } else if (!err?.response) {
        const texto = dryRun
          ? mensajeDeError(err)
          : `${mensajeDeError(err)} Revisa en Candidatos si se alcanzó a guardar antes de reintentar.`
        actualizado = marcarTodos(lote, texto)
      } else {
        actualizado = marcarTodos(lote, mensajeDeError(err, `Error del servidor (${status}).`))
      }
    }
    reemplazar(actualizado)
    hechos += lote.length
    onProgreso?.({ hechos, total: objetivo.length, lote: k + 1, lotes: lotes.length })
  }

  if (dryRun) actuales = marcarDuplicados(actuales)
  return { items: actuales, fatal: null, cancelado: false, avisoServidor }
}
