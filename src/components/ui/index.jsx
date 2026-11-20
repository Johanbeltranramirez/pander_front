import { useState } from 'react'
// src/components/ui/index.jsx
// ══════════════════════════════════════════════
// Librería de componentes reutilizables Pander UI
// ══════════════════════════════════════════════
import styles from './ui.module.css'
import { IoIosSearch } from "react-icons/io";
import { MdClose, MdInbox } from 'react-icons/md';
/* ── Spinner ── */
export function Spinner({ size = 'md', label = 'Cargando...' }) {
  return (
    <div className={`${styles.spinnerWrap} ${styles[`spinner_${size}`]}`} role="status">
      <div className={styles.spinner} />
      {label && <span className={styles.spinnerLabel}>{label}</span>}
    </div>
  )
}

/* ── Button ── */
export function Button({
  children, variant = 'primary', size = 'md',
  loading = false, icon, className = '', ...props
}) {
  return (
    <button
      className={[styles.btn, styles[`btn_${variant}`], styles[`btn_${size}`], className].join(' ')}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <span className={styles.btnSpinner} /> : icon && <span className={styles.btnIcon}>{icon}</span>}
      {children}
    </button>
  )
}

/* ── Input ── */
export function Input({ label, error, className = '', ...props }) {
  return (
    <div className={styles.inputGroup}>
      {label && <label className={styles.label}>{label}</label>}
      <input className={[styles.input, error ? styles.inputError : '', className].join(' ')} {...props} />
      {error && <span className={styles.inputHint}>{error}</span>}
    </div>
  )
}

/* ── Select ── */
export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className={styles.inputGroup}>
      {label && <label className={styles.label}>{label}</label>}
      <select className={[styles.input, error ? styles.inputError : '', className].join(' ')} {...props}>
        {children}
      </select>
      {error && <span className={styles.inputHint}>{error}</span>}
    </div>
  )
}

/* ── Card ── */
export function Card({ children, className = '', ...props }) {
  return <div className={[styles.card, className].join(' ')} {...props}>{children}</div>
}

/* ── PageHeader ── */
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      {action && <div className={styles.pageAction}>{action}</div>}
    </div>
  )
}

/* ── Badge ── */
export function Badge({ children, variant = 'primary' }) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}

/* ── Empty ── */
export function Empty({ message = 'Sin resultados' }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}><MdInbox size={40} color="var(--text-muted)"/></span>
      <p>{message}</p>
    </div>
  )
}

/* ── Alert ── */
export function Alert({ type = 'info', children, onClose }) {
  return (
    <div className={`${styles.alert} ${styles[`alert_${type}`]}`}>
      <span>{children}</span>
      {onClose && <button className={styles.alertClose} onClick={onClose}><MdClose size={16}/></button>}
    </div>
  )
}

/* ── Modal ── */
export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={[styles.modal, styles[`modal_${size}`]].join(' ')}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button className={styles.modalClose} onClick={onClose}><MdClose size={16}/></button>
        </div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  )
}

/* ── Table ── */
export function Table({ columns, data, loading, empty = 'Sin datos', rowKey = 'id', actions, pageSize = 10 }) {
  const [page, setPage] = useState(1)
  if (loading) return <Spinner label="Cargando tabla..." />
  if (!data?.length) return <Empty message={empty} />
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  const pageData = data.slice(start, start + pageSize)
  return (
    <div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.key} style={col.width ? { width: col.width } : {}}>
                  {col.label}
                </th>
              ))}
              {actions && <th className={styles.thActions}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => (
              <tr key={row[rowKey] ?? (start + i)}>
                {columns.map(col => (
                  <td key={col.key}>
                    {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                  </td>
                ))}
                {actions && <td className={styles.tdActions}>{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>
            Mostrando {start + 1}–{Math.min(start + pageSize, data.length)} de {data.length}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? .5 : 1 }}>
              ‹ Anterior
            </button>
            <span style={{ padding: '4px 10px', fontSize: '.8rem', fontWeight: 600 }}>{currentPage} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? .5 : 1 }}>
              Siguiente ›
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── SearchBar ── */
export function SearchBar({ value, onChange, placeholder = 'Buscar...' }) {
  return (
    <div className={styles.searchBar}>
      <span className={styles.searchIcon}><IoIosSearch /></span>
      <input
        className={styles.searchInput}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button className={styles.searchClear} onClick={() => onChange('')}><MdClose size={14}/></button>
      )}
    </div>
  )
}

/* ── Confirm Dialog ── */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p style={{ marginBottom: '1.5rem', color: 'var(--text)' }}>{message}</p>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>Eliminar</Button>
      </div>
    </Modal>
  )
}
