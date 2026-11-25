import { useState, useRef, useEffect, useCallback } from 'react'
import { Card, Alert, Spinner, Badge } from '../../components/ui'
import { importacionService } from '../../services'
import {
  MdUpload, MdCheckCircle, MdError, MdWarning, MdRefresh, MdClose,
  MdDescription, MdStop,
} from 'react-icons/md'
import { CheckCircle2, XCircle, Search, ClipboardList } from 'lucide-react'
import {
  ACCEPT_CV, EXTENSIONES_CV, MB, MAX_MB_DEFECTO, MAX_TOTAL_CV, LOTE_CV,
  clasificarArchivos, construirFormData, formatearTamanio, procesarEnLotes, resumen,
} from './cvImport'

// campos que saca la IA (* = obligatorio para poder importar)
const CAMPOS_IA = [
  'primer_nombre *', 'primer_apellido *', 'email *', 'segundo_nombre',
  'segundo_apellido', 'tipo_documento', 'numero_documento', 'telefono',
]

const COLORES = {
  OK:        { fondo: '#f0fdf4', borde: '#bbf7d0', texto: '#15803d' },
  IMPORTADO: { fondo: '#eff6ff', borde: '#bfdbfe', texto: '#1d4ed8' },
  ERROR:     { fondo: '#fef2f2', borde: '#fecaca', texto: '#dc2626' },
  PENDIENTE: { fondo: 'var(--bg)', borde: 'var(--border)', texto: 'var(--text-muted)' },
}

const ETIQUETA = { OK: 'Válido', IMPORTADO: 'Importado', ERROR: 'Error', PENDIENTE: 'Pendiente' }

// Alert no recibe style, así que el margen va en un div
function Aviso({ type, children, onClose, abajo = 14 }) {
  return <div style={{ marginBottom: abajo }}><Alert type={type} onClose={onClose}>{children}</Alert></div>
}

function nombreCompleto(d) {
  return [d?.primer_nombre, d?.segundo_nombre, d?.primer_apellido, d?.segundo_apellido]
    .filter(Boolean).join(' ')
}

// ── Zona para soltar varios archivos ──────────────────────────
function DropZoneCV({ onArchivos, disabled, maxMb, maxTotal }) {
  const ref = useRef(null)
  const [arrastrando, setArrastrando] = useState(false)

  const soltar = e => {
    e.preventDefault(); setArrastrando(false)
    if (!disabled) onArchivos(e.dataTransfer.files)
  }

  return (
    <div
      onClick={() => !disabled && ref.current?.click()}
      onDragOver={e => { e.preventDefault(); if (!disabled) setArrastrando(true) }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={soltar}
      style={{
        border: `2px dashed ${arrastrando ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 12, padding: '24px 20px', textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all .2s',
        background: arrastrando ? 'var(--primary-bg)' : 'var(--bg)',
        opacity: disabled ? .6 : 1,
      }}>
      <MdUpload size={34} color={arrastrando ? 'var(--primary)' : '#94a3b8'} style={{ marginBottom: 6 }}/>
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--text-h)', marginBottom: 4 }}>
        Arrastra las hojas de vida aquí o haz clic para seleccionarlas
      </div>
      <div style={{ fontSize: '.77rem', color: 'var(--text-muted)' }}>
        {EXTENSIONES_CV.filter(e => e !== 'jpeg' && e !== 'htm').map(e => e.toUpperCase()).join(' · ')}
        {' '}— varios archivos a la vez, máx. {maxMb} MB c/u (hasta {maxTotal})
      </div>
      <input ref={ref} type="file" multiple accept={ACCEPT_CV} style={{ display: 'none' }}
        onChange={e => { onArchivos(e.target.files); e.target.value = '' }}/>
    </div>
  )
}

// ── Una fila de la lista de resultados ────────────────────────
function FilaResultado({ item }) {
  const c = COLORES[item.estado] || COLORES.PENDIENTE
  const d = item.datos
  const Icono = item.estado === 'ERROR' ? MdError : MdCheckCircle
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 6, marginBottom: 6,
      background: c.fondo, border: `1px solid ${c.borde}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icono size={15} color={c.texto} style={{ flexShrink: 0, marginTop: 2 }}/>
        <div style={{ fontSize: '.8rem', minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, color: c.texto, wordBreak: 'break-all' }}>
            {item.nombre}
          </div>
          {item.mensaje && !(item.estado === 'OK' && d) && (   // en OK el mensaje solo repite los datos de abajo
            <div style={{ color: '#374151', marginTop: 2 }}>{item.mensaje}</div>
          )}
          {d && item.estado !== 'PENDIENTE' && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '2px 14px', marginTop: 6, fontSize: '.75rem', color: '#4b5563',
            }}>
              <span><b>Nombre:</b> {nombreCompleto(d) || '—'}</span>
              <span><b>Correo:</b> {d.email || '—'}</span>
              <span><b>Documento:</b> {d.numero_documento
                ? `${d.tipo_documento || 's/tipo'} ${d.numero_documento}` : '—'}</span>
              <span><b>Teléfono:</b> {d.telefono || '—'}</span>
            </div>
          )}
          {item.advertencias?.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: '.74rem', color: '#92400e' }}>
              {item.advertencias.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────
export default function ImportacionCV({ cid, uid }) {
  const [modelo,    setModelo]    = useState(null)      // respuesta de /cv/estado/
  const [items,     setItems]     = useState([])
  const [rechazados, setRechazados] = useState([])
  const [fase,      setFase]      = useState('idle')    // idle | analizando | analizado | importando | listo | error
  const [progreso,  setProgreso]  = useState(null)
  const [msgError,  setMsgError]  = useState(null)
  const [aviso,     setAviso]     = useState(null)
  const [soloValidos, setSoloValidos] = useState(true)
  const ctrl = useRef(null)

  const maxMb = modelo?.max_mb || MAX_MB_DEFECTO
  const lote  = Math.min(LOTE_CV, modelo?.max_archivos || LOTE_CV)
  const ocupado = fase === 'analizando' || fase === 'importando'
  const r = resumen(items)

  // al entrar, preguntamos si el modelo está listo
  useEffect(() => {
    let vivo = true
    importacionService.estadoCV()
      .then(res => { if (vivo) setModelo(res.data) })
      .catch(() => { if (vivo) setModelo({ disponible: false, motivo: 'No se pudo consultar el estado del modelo de IA.' }) })
    return () => { vivo = false }
  }, [])

  // si cambia la lista, lo analizado antes ya no vale
  const limpiarResultados = () => {
    setFase('idle'); setMsgError(null); setAviso(null); setProgreso(null)
  }

  const agregar = useCallback(files => {
    const { aceptados, rechazados: no } = clasificarArchivos(
      files, items, { maxBytes: maxMb * MB, maxTotal: MAX_TOTAL_CV })
    setRechazados(no)
    if (aceptados.length === 0) return
    setItems(prev => [
      ...prev.map(i => ({ ...i, estado: 'PENDIENTE', mensaje: '', datos: null, advertencias: [] })),
      ...aceptados,
    ])
    limpiarResultados()
  }, [items, maxMb])

  const quitar = id => {
    setItems(prev => prev.filter(i => i.id !== id).map(i => (
      { ...i, estado: 'PENDIENTE', mensaje: '', datos: null, advertencias: [] })))
    limpiarResultados()
  }

  const reiniciar = () => {
    setItems([]); setRechazados([]); limpiarResultados()
  }

  const enviar = (archivos, { dryRun, omitirErrores, signal }) =>
    importacionService.candidatosCV(
      cid, construirFormData(archivos, { dryRun, omitirErrores, usuarioId: uid }), { signal })

  const correr = async (dryRun) => {
    ctrl.current = new AbortController()
    setFase(dryRun ? 'analizando' : 'importando')
    setMsgError(null); setAviso(null)
    const res = await procesarEnLotes({
      items, enviar, dryRun, omitirErrores: soloValidos, tamLote: lote,
      seleccion: dryRun ? () => true : i => i.estado === 'OK',
      onProgreso: setProgreso, signal: ctrl.current.signal,
    })
    setItems(res.items)
    setProgreso(null)
    if (res.fatal) { setMsgError(res.fatal); setFase('error'); return }
    if (res.cancelado) { setAviso('Proceso cancelado. Lo que ya se procesó se conserva.'); setFase(dryRun ? 'idle' : 'analizado'); return }
    if (res.avisoServidor) setAviso(res.avisoServidor)
    setFase(dryRun ? 'analizado' : 'listo')
  }

  const puedeAnalizar = items.length > 0 && !ocupado && fase !== 'listo' && modelo?.disponible !== false
  const hayErrores = r.errores > 0
  const puedeImportar = fase === 'analizado' && r.ok > 0 && (soloValidos || !hayErrores)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

      {/* ── Izquierda: selección y acciones ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <h3 style={{ margin: '0 0 4px', fontSize: '.95rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 7 }}>
            <MdDescription size={17} color="var(--primary)"/> Candidatos desde hojas de vida
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: '.78rem', color: 'var(--text-muted)' }}>
            El modelo de IA lee cada hoja de vida y crea el candidato con los datos que encuentra.
            El archivo original queda guardado como anexo del candidato.
          </p>

          {modelo && modelo.disponible === false && (
            <Aviso type="error">
              La importación con IA no está disponible: {modelo.motivo}
            </Aviso>
          )}

          <div style={{ background: 'var(--primary-bg)', borderRadius: 10, padding: '10px 14px',
            border: '1px solid var(--primary-border)', marginBottom: 14 }}>
            <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
              Datos que extrae la IA
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CAMPOS_IA.map(c => {
                const req = c.endsWith(' *')
                return (
                  <span key={c} style={{
                    padding: '3px 10px', borderRadius: 99, fontSize: '.75rem', fontWeight: 600,
                    background: req ? 'var(--primary)' : 'var(--border)',
                    color: req ? '#fff' : 'var(--text-muted)',
                  }}>{c}</span>
                )
              })}
            </div>
            <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 8 }}>
              * = obligatorio. Si la hoja de vida no trae correo electrónico, no se importa.
            </div>
          </div>

          <DropZoneCV onArchivos={agregar} disabled={ocupado || fase === 'listo'}
            maxMb={maxMb} maxTotal={MAX_TOTAL_CV}/>

          {rechazados.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Alert type="warning" onClose={() => setRechazados([])}>
                No se agregaron {rechazados.length} archivo(s):{' '}
                {rechazados.slice(0, 4).map(x => `${x.nombre} (${x.motivo})`).join(', ')}
                {rechazados.length > 4 && ` y ${rechazados.length - 4} más`}
              </Alert>
            </div>
          )}

          {/* Lista de archivos seleccionados */}
          {items.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '.8rem', fontWeight: 700, marginBottom: 6 }}>
                {items.length} archivo(s) seleccionado(s)
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)',
                borderRadius: 8 }}>
                {items.map(i => {
                  const c = COLORES[i.estado] || COLORES.PENDIENTE
                  return (
                    <div key={i.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                      borderBottom: '1px solid var(--border)', fontSize: '.78rem',
                    }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.nombre}>
                        {i.nombre}
                      </span>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                        {formatearTamanio(i.tamanio)}
                      </span>
                      <span style={{ color: c.texto, fontWeight: 700, flexShrink: 0, minWidth: 62,
                        textAlign: 'right' }}>
                        {ETIQUETA[i.estado]}
                      </span>
                      <button onClick={() => quitar(i.id)} disabled={ocupado || fase === 'listo'}
                        title="Quitar de la lista" aria-label={`Quitar ${i.nombre}`}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer',
                          color: 'var(--text-muted)', display: 'flex', padding: 0 }}>
                        <MdClose size={15}/>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14,
            fontSize: '.8rem', color: 'var(--text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={soloValidos} disabled={ocupado}
              onChange={e => setSoloValidos(e.target.checked)}/>
            Importar solo las hojas de vida válidas (las que tengan error se omiten)
          </label>

          {/* Barra de progreso */}
          {ocupado && progreso && (
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--primary)', transition: 'width .3s',
                  width: `${Math.round((progreso.hechos / Math.max(progreso.total, 1)) * 100)}%` }}/>
              </div>
              <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Lote {progreso.lote} de {progreso.lotes} · {progreso.hechos} de {progreso.total} archivos
                {fase === 'analizando' ? ' analizados' : ' procesados'}
              </div>
            </div>
          )}

          {/* Botones */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={() => correr(true)} disabled={!puedeAnalizar} style={{
              flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
              background: puedeAnalizar ? '#2563eb' : 'var(--border)',
              color: puedeAnalizar ? '#fff' : 'var(--text-muted)',
              cursor: puedeAnalizar ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font)', fontWeight: 700, fontSize: '.88rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {fase === 'analizando' ? <Spinner size="xs"/> : <MdCheckCircle size={16}/>}
              {fase === 'analizando' ? 'Analizando...' : '1. Analizar'}
            </button>

            <button onClick={() => correr(false)} disabled={!puedeImportar} style={{
              flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
              background: puedeImportar ? '#15803d' : 'var(--border)',
              color: puedeImportar ? '#fff' : 'var(--text-muted)',
              cursor: puedeImportar ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font)', fontWeight: 700, fontSize: '.88rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {fase === 'importando' ? <Spinner size="xs"/> : <MdUpload size={16}/>}
              {fase === 'importando' ? 'Importando...' : `2. Importar${r.ok ? ` (${r.ok})` : ''}`}
            </button>

            {ocupado ? (
              <button onClick={() => ctrl.current?.abort()} style={{
                padding: '10px 14px', borderRadius: 8, border: '1px solid #fecaca',
                background: '#fef2f2', cursor: 'pointer', color: '#dc2626',
                fontFamily: 'var(--font)', fontSize: '.82rem',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <MdStop size={15}/> Cancelar
              </button>
            ) : items.length > 0 && (
              <button onClick={reiniciar} style={{
                padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg)', cursor: 'pointer', color: 'var(--text-muted)',
                fontFamily: 'var(--font)', fontSize: '.82rem',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <MdRefresh size={15}/> Reiniciar
              </button>
            )}
          </div>

          {fase === 'analizado' && hayErrores && !soloValidos && (
            <div style={{ fontSize: '.76rem', color: '#dc2626', marginTop: 8 }}>
              Hay archivos con error. Quítalos de la lista o activa "importar solo las válidas".
            </div>
          )}
        </Card>

        <Card>
          <h4 style={{ margin: '0 0 10px', fontSize: '.85rem', fontWeight: 700 }}>📋 Instrucciones</h4>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: '.8rem',
            color: 'var(--text-muted)', lineHeight: 1.8 }}>
            <li>Selecciona o arrastra las hojas de vida (puedes mezclar formatos).</li>
            <li>Haz clic en <strong>1. Analizar</strong>: la IA lee cada archivo, no guarda nada todavía.</li>
            <li>Revisa los datos extraídos y los avisos de cada archivo.</li>
            <li>Haz clic en <strong>2. Importar</strong> para crear los candidatos.</li>
          </ol>
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: '#fef9c3', border: '1px solid #fde68a', fontSize: '.77rem', color: '#92400e' }}>
            <MdWarning size={13} style={{ marginRight: 5 }}/>
            Los archivos escaneados o las imágenes se leen con OCR y pueden tardar más.
            Si el correo sale mal leído, el archivo aparece con error y no se importa.
          </div>
        </Card>
      </div>

      {/* ── Derecha: resultado ── */}
      <div>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: '.95rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 8 }}>
              {fase === 'listo' ? <><CheckCircle2 size={18} color="#16a34a"/> Resultado de Importación</>
                : fase === 'error' ? <><XCircle size={18} color="#dc2626"/> Error</>
                : fase === 'analizado' ? <><Search size={18} color="#2563eb"/> Resultado del análisis</>
                : <><ClipboardList size={18} color="#64748b"/> Resultado</>}
            </h3>
            {(r.ok > 0 || r.errores > 0 || r.importados > 0) && (
              <div style={{ display: 'flex', gap: 8 }}>
                {r.importados > 0 && <Badge variant="primary">{r.importados} importados</Badge>}
                {r.ok > 0 && <Badge variant="success">{r.ok} OK</Badge>}
                {r.errores > 0 && <Badge variant="danger">{r.errores} Errores</Badge>}
              </div>
            )}
          </div>

          {fase === 'listo' && r.importados > 0 && (
            <Aviso type="success">
              ✅ Importación completada. <strong>{r.importados}</strong> candidato(s) creado(s)
              {r.errores > 0 && <> y <strong>{r.errores}</strong> archivo(s) sin importar</>}.
            </Aviso>
          )}
          {fase === 'listo' && r.importados === 0 && (
            <Aviso type="error">No se importó ningún candidato.</Aviso>
          )}
          {fase === 'analizado' && r.errores === 0 && r.ok > 0 && (
            <Aviso type="success">
              ✅ Análisis exitoso — <strong>{r.ok} hoja(s) de vida</strong> lista(s).
              Puedes proceder con la importación.
            </Aviso>
          )}
          {fase === 'analizado' && r.errores > 0 && (
            <Aviso type={r.ok > 0 ? 'warning' : 'error'}>
              {r.errores} archivo(s) con error.{' '}
              {r.ok > 0
                ? (soloValidos ? 'Se importarán solo los válidos.' : 'Quítalos o activa "importar solo las válidas".')
                : 'No hay ninguno listo para importar.'}
            </Aviso>
          )}
          {aviso && <Aviso type="warning">{aviso}</Aviso>}
          {msgError && <Aviso type="error">{msgError}</Aviso>}

          {items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>
              <MdDescription size={40} style={{ opacity: .2, marginBottom: 12 }}/>
              <p style={{ fontSize: '.85rem' }}>
                Agrega hojas de vida y haz clic en "Analizar" para ver aquí lo que extrajo la IA.
              </p>
            </div>
          )}
          {items.length > 0 && r.pendientes === items.length && !ocupado && (
            <p style={{ fontSize: '.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
              {items.length} archivo(s) esperando análisis.
            </p>
          )}
          {items.some(i => i.estado !== 'PENDIENTE') && (
            <div style={{ maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>
              {items.filter(i => i.estado !== 'PENDIENTE').map(i => <FilaResultado key={i.id} item={i}/>)}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
