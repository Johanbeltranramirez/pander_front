// Pruebas del componente de carga de hojas de vida (servicio simulado, no necesita backend).
// Necesita en devDependencies: vitest, jsdom, @testing-library/react, @testing-library/user-event,
// @testing-library/jest-dom   ->   npx vitest run   (environment: 'jsdom')
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

vi.mock('../../services', () => ({
  importacionService: { estadoCV: vi.fn(), candidatosCV: vi.fn() },
}))
import { importacionService } from '../../services'
import ImportacionCV from './ImportacionCV'

const ESTADO_OK = { data: { disponible: true, motivo: null, max_archivos: 50, max_mb: 10 } }
const pdf = (n, size = 500) => new File([new Uint8Array(size)], n, { type: 'application/pdf', lastModified: 1 })

// Backend de mentira: cada archivo "malo*" no trae correo; los demás sí.
function responder(cid, fd) {
  const dry = fd.get('dry_run') === 'true'
  const log = fd.getAll('archivos').map((f, i) => (f.name.startsWith('malo')
    ? { fila: i + 1, archivo: f.name, estado: 'ERROR', mensaje: 'No se encontró un correo electrónico (campo obligatorio).', datos: null, advertencias: [] }
    : {
      fila: i + 1, archivo: f.name, estado: 'OK', mensaje: `Persona <${f.name}@x.com>`, advertencias: [],
      datos: { primer_nombre: 'Ana', segundo_nombre: null, primer_apellido: 'Gil', segundo_apellido: null,
               tipo_documento: null, numero_documento: null, email: `${f.name}@x.com`, telefono: null },
      ...(dry ? {} : { candidato_id: 1 }),
    }))
  return Promise.resolve({ status: dry ? 200 : 201, data: { log } })
}

const montar = () => render(<ImportacionCV cid={7} uid={3} />)
const subir = (user, archivos) => user.upload(document.querySelector('input[type=file]'), archivos)

afterEach(cleanup)   // sin "globals: true" en vitest, RTL no limpia el DOM solo

beforeEach(() => {
  vi.clearAllMocks()
  importacionService.estadoCV.mockResolvedValue(ESTADO_OK)
  importacionService.candidatosCV.mockImplementation(responder)
})

describe('ImportacionCV', () => {
  test('muestra que el email es obligatorio', async () => {
    montar()
    expect(await screen.findByText('email *')).toBeInTheDocument()
  })

  test('si el modelo no está disponible lo avisa y no deja analizar', async () => {
    importacionService.estadoCV.mockResolvedValue({ data: { disponible: false, motivo: 'No se encontró el modelo' } })
    const user = userEvent.setup({ applyAccept: false })
    montar()
    expect(await screen.findByText(/no está disponible: No se encontró el modelo/)).toBeInTheDocument()
    await subir(user, [pdf('a.pdf')])
    expect(screen.getByRole('button', { name: /1\. Analizar/ })).toBeDisabled()
  })

  test('rechaza formatos no permitidos y los muestra', async () => {
    const user = userEvent.setup({ applyAccept: false })
    montar()
    await subir(user, [pdf('a.pdf'), new File(['x'], 'virus.exe', { lastModified: 1 })])
    expect(screen.getByText('1 archivo(s) seleccionado(s)')).toBeInTheDocument()
    expect(screen.getByText(/virus\.exe \(formato no permitido\)/)).toBeInTheDocument()
  })

  test('analiza en lotes de 10, importa solo los válidos y manda usuario y banderas', async () => {
    const user = userEvent.setup({ applyAccept: false })
    montar()
    const archivos = Array.from({ length: 14 }, (_, i) => pdf(`cv${i + 1}.pdf`, 100 + i))
    archivos.push(pdf('malo.pdf', 999))
    await subir(user, archivos)

    await user.click(screen.getByRole('button', { name: /1\. Analizar/ }))
    expect(await screen.findByText('14 OK')).toBeInTheDocument()
    expect(screen.getByText('1 Errores')).toBeInTheDocument()
    // 15 archivos => 2 peticiones de análisis (10 + 5), siempre dry_run
    expect(importacionService.candidatosCV).toHaveBeenCalledTimes(2)
    const [cid, fd1] = importacionService.candidatosCV.mock.calls[0]
    expect(cid).toBe(7)
    expect(fd1.get('dry_run')).toBe('true')
    expect(fd1.get('usuario_id')).toBe('3')
    expect(fd1.getAll('archivos')).toHaveLength(10)

    importacionService.candidatosCV.mockClear()
    await user.click(screen.getByRole('button', { name: /2\. Importar \(14\)/ }))
    expect(await screen.findByText(/Importación completada/)).toBeInTheDocument()
    expect(screen.getByText('14 importados')).toBeInTheDocument()
    // el archivo con error no se vuelve a enviar
    const enviados = importacionService.candidatosCV.mock.calls.flatMap(([, fd]) => fd.getAll('archivos'))
    expect(enviados).toHaveLength(14)
    expect(enviados.some(f => f.name === 'malo.pdf')).toBe(false)
    expect(importacionService.candidatosCV.mock.calls.every(([, fd]) => fd.get('dry_run') === 'false')).toBe(true)
  })

  test('con "solo válidas" apagado, los errores bloquean la importación', async () => {
    const user = userEvent.setup({ applyAccept: false })
    montar()
    await subir(user, [pdf('a.pdf', 10), pdf('malo.pdf', 20)])
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /1\. Analizar/ }))
    await screen.findByText('1 Errores')
    expect(screen.getByRole('button', { name: /2\. Importar/ })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /2\. Importar/ })).toBeEnabled()
  })

  test('muestra el error cuando el servidor corta todo (503)', async () => {
    importacionService.candidatosCV.mockRejectedValue(
      { response: { status: 503, data: { error: 'El modelo de IA no está disponible: falta torch' } } })
    const user = userEvent.setup({ applyAccept: false })
    montar()
    await subir(user, [pdf('a.pdf')])
    await user.click(screen.getByRole('button', { name: /1\. Analizar/ }))
    expect(await screen.findByText(/falta torch/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /1\. Analizar/ })).toBeEnabled())
  })

  test('quitar un archivo de la lista invalida el análisis anterior', async () => {
    const user = userEvent.setup({ applyAccept: false })
    montar()
    await subir(user, [pdf('a.pdf', 10), pdf('b.pdf', 20)])
    await user.click(screen.getByRole('button', { name: /1\. Analizar/ }))
    await screen.findByText('2 OK')
    await user.click(screen.getByRole('button', { name: 'Quitar a.pdf' }))
    expect(screen.queryByText('2 OK')).toBeNull()
    expect(screen.getByRole('button', { name: /2\. Importar/ })).toBeDisabled()
  })
})
