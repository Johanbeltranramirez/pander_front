// src/layout/MainLayout.jsx — react-icons + menú dinámico
import { useState, useEffect, useMemo, useRef } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api/axios'
import styles from '../components/layout/Layout.module.css'
import logo from '../assets/logo.png'

// ── react-icons ───────────────────────────────────────────────
import {
  MdDashboard, MdBusiness, MdAccountTree, MdKey, MdBadge,
  MdPerson, MdExtension, MdWork, MdGroups, MdAssignment,
  MdSettings, MdBarChart, MdChevronRight, MdChevronLeft,
  MdExpandMore, MdExpandLess, MdLogout, MdRefresh,
  MdSearch, MdClose, MdSwapHoriz, MdCheckCircle, MdMenu,
} from 'react-icons/md'
import { TbTableImport } from "react-icons/tb";

// Mapa ruta → ícono (cuando la BD no devuelve icono)
const ROUTE_ICON = {
  '/':                     MdDashboard,
  '/importacion':     TbTableImport,
  '/gestion-compania':     MdBusiness,
  '/gestion-unidades':     MdAccountTree,
  '/gestion-roles':        MdKey,
  '/gestion-analistas':    MdBadge,
  '/gestion-usuarios':     MdPerson,
  '/gestion-modulos':      MdExtension,
  '/gestion-vacantes':     MdWork,
  '/gestion-candidatos':   MdGroups,
  '/gestion-postulaciones':MdAssignment,
  '/gestion-evaluaciones': MdSettings,
  '/evaluacion':           MdBarChart,
}

function getIcon(nodo, size = 18) {
  const Ic = ROUTE_ICON[nodo.nombre_aplicacion] || MdExtension
  return <Ic size={size} />
}

function buildTree(modulos) {
  const map = {}; const roots = []
  modulos.forEach(m => { map[m.id] = { ...m, hijos: [] } })
  modulos.forEach(m => {
    if (m.modulo_padre && map[m.modulo_padre]) map[m.modulo_padre].hijos.push(map[m.id])
    else roots.push(map[m.id])
  })
  return roots
}

const NAV_GROUPS = [
  { label: 'Inicio', items: [
    { path: '/', label: 'Dashboard', icon: MdDashboard },
  ]},
  { label: 'Gestion de Talento', items: [
    { path: '/gestion-candidatos',    label: 'Candidatos',     icon: MdGroups },
    { path: '/gestion-vacantes',      label: 'Vacantes',       icon: MdWork },
    { path: '/gestion-postulaciones', label: 'Postulaciones',  icon: MdAssignment },
  ]},
  { label: 'Evaluacion de Habilidades Blandas', items: [
    { path: '/gestion-evaluaciones', label: 'Gestion de Evaluaciones', icon: MdSettings },
    { path: '/evaluacion',           label: 'Reportes Estadisticos',   icon: MdBarChart },
  ]},
  { label: 'Administracion', items: [
    { path: '/gestion-compania',   label: 'Companias',  icon: MdBusiness },
    { path: '/gestion-unidades',   label: 'Unidades',   icon: MdAccountTree },
    { path: '/gestion-roles',      label: 'Roles',      icon: MdKey },
    { path: '/gestion-analistas',  label: 'Analistas',  icon: MdBadge },
    { path: '/gestion-usuarios',   label: 'Usuarios',   icon: MdPerson },
    { path: '/gestion-modulos',    label: 'Modulos',    icon: MdExtension },
  ]},
  { label: 'Datos', items: [
    { path: '/importacion', label: 'Importacion Masiva', icon: TbTableImport },
  ]},
]

const GROUP_ORDER = ['Inicio','Gestion de Talento','Evaluacion de Habilidades Blandas','Administracion','Datos','Otros']

const ROUTE_GROUP = {
  '/': 'Inicio',
  '/gestion-candidatos': 'Gestion de Talento',
  '/gestion-vacantes': 'Gestion de Talento',
  '/gestion-postulaciones': 'Gestion de Talento',
  '/gestion-evaluaciones': 'Evaluacion de Habilidades Blandas',
  '/evaluacion': 'Evaluacion de Habilidades Blandas',
  '/gestion-compania': 'Administracion',
  '/gestion-unidades': 'Administracion',
  '/gestion-roles': 'Administracion',
  '/gestion-analistas': 'Administracion',
  '/gestion-usuarios': 'Administracion',
  '/gestion-modulos': 'Administracion',
  '/importacion': 'Datos',
}

function grupoDeRuta(path) {
  return ROUTE_GROUP[path] || 'Otros'
}

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap(g =>
  g.items.map(it => ({ ...it, group: g.label }))
)
const CONFIGURED_PATHS = new Set(ALL_NAV_ITEMS.map(i => i.path))

function getAllowedPaths(user) {
  if (user?.ind_super_usuario) return null
  return new Set((user?.modulos ?? []).map(m => m.nombre_aplicacion))
}

// ── NavNode con react-icons ───────────────────────────────────
function NavNode({ nodo, collapsed, nivel = 0 }) {
  const [open, setOpen] = useState(false)
  const tieneHijos = (nodo.hijos?.length ?? 0) > 0
  const ruta   = nodo.nombre_aplicacion || '#'
  const indent = nivel > 0 ? `${8 + nivel * 14}px` : undefined

  if (tieneHijos) {
    const esNavegable = ruta !== '#'
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {esNavegable ? (
            <NavLink to={ruta} end={ruta === '/'}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
              style={{ flex: 1, paddingLeft: indent }}
              title={collapsed ? nodo.descripcion : undefined}>
              <span className={styles.navIcon}>{getIcon(nodo)}</span>
              {!collapsed && <span className={styles.navLabel}>{nodo.descripcion}</span>}
            </NavLink>
          ) : (
            <button className={styles.navItem}
              style={{ flex: 1, paddingLeft: indent, textAlign: 'left' }}
              title={collapsed ? nodo.descripcion : undefined}
              onClick={() => setOpen(o => !o)}>
              <span className={styles.navIcon}>{getIcon(nodo)}</span>
              {!collapsed && <span className={styles.navLabel}>{nodo.descripcion}</span>}
            </button>
          )}
          {!collapsed && (
            <button onClick={() => setOpen(o => !o)}
              style={{ background:'none', border:'none', cursor:'pointer',
                color:'rgba(255,255,255,.5)', padding:'0 8px', flexShrink:0 }}>
              {open ? <MdExpandLess size={16}/> : <MdExpandMore size={16}/>}
            </button>
          )}
        </div>
        {open && !collapsed && (
          <div style={{ borderLeft:'2px solid rgba(255,255,255,.1)', marginLeft:20 }}>
            {nodo.hijos.map(h => <NavNode key={h.id} nodo={h} collapsed={collapsed} nivel={nivel+1}/>)}
          </div>
        )}
      </div>
    )
  }

  return (
    <NavLink to={ruta} end={ruta === '/'}
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
      title={collapsed ? nodo.descripcion : undefined}
      style={{ paddingLeft: indent }}>
      <span className={styles.navIcon}>{getIcon(nodo)}</span>
      {!collapsed && <span className={styles.navLabel}>{nodo.descripcion}</span>}
    </NavLink>
  )
}

// ── Selector de Compañía ──────────────────────────────────────
function SelectorCompania({ onClose }) {
  const { user, cambiarCompania } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery]       = useState('')
  const [lista, setLista]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [cambiando, setCambiando] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    api.get('/api/acceso/auth/mis-companias/', { params: { usuario_id: user.id, q: '' } })
      .then(r => setLista(r.data)).finally(() => setLoading(false))
  }, [user.id])

  const filtradas = useMemo(() => {
    if (!query.trim()) return lista
    return lista.filter(c => c.descripcion.toLowerCase().includes(query.toLowerCase()))
  }, [lista, query])

  const seleccionar = async (cid) => {
    if (cid === user.compania) { onClose(); return }
    setCambiando(cid)
    try { await cambiarCompania(cid); onClose(); navigate('/') }
    catch (e) { alert(e.message) }
    finally { setCambiando(null) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000, padding:16 }}
      onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:460,
        boxShadow:'0 20px 60px rgba(0,0,0,.25)', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ background:'var(--primary)', padding:'18px 24px',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ color:'#fff', fontWeight:700, fontSize:'1rem', display:'flex', alignItems:'center', gap:8 }}>
              <MdBusiness size={18}/> Seleccionar Compañía
            </div>
            <div style={{ color:'rgba(255,255,255,.7)', fontSize:'.8rem', marginTop:2 }}>
              En sesión: <strong style={{color:'#fff'}}>{user.compania_nombre}</strong>
            </div>
          </div>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,.15)', border:'none',
            color:'#fff', width:30, height:30, borderRadius:'50%', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <MdClose size={16}/>
          </button>
        </div>
        <div style={{ padding:'14px 24px 8px' }}>
          <div style={{ position:'relative' }}>
            <MdSearch size={16} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)',
              color:'var(--text-muted)' }}/>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por nombre de compañía..."
              style={{ width:'100%', padding:'9px 12px 9px 32px', border:'1.5px solid var(--border)',
                borderRadius:8, fontFamily:'var(--font)', fontSize:'.9rem', outline:'none' }}/>
          </div>
        </div>
        <div style={{ maxHeight:300, overflowY:'auto', padding:'6px 24px 20px' }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:24, color:'var(--text-muted)' }}>Cargando...</div>
          ) : !filtradas.length ? (
            <div style={{ textAlign:'center', padding:24, color:'var(--text-muted)' }}>Sin resultados.</div>
          ) : filtradas.map(c => (
            <button key={c.id} onClick={() => seleccionar(c.id)} disabled={!!cambiando}
              style={{ width:'100%', padding:'11px 16px', borderRadius:10, marginBottom:6,
                border:`2px solid ${c.id===user.compania?'var(--primary)':'var(--border)'}`,
                background:c.id===user.compania?'var(--primary-bg)':'var(--bg)',
                cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center',
                justifyContent:'space-between', fontFamily:'var(--font)', transition:'all .15s',
                opacity: cambiando && cambiando!==c.id ? .5 : 1 }}>
              <div>
                <div style={{ fontWeight:600, fontSize:'.9rem' }}>{c.descripcion}</div>
                <div style={{ fontSize:'.74rem', color:'var(--text-muted)' }}>NIT: {c.nit}</div>
              </div>
              {c.id===user.compania
                ? <span style={{ fontSize:'.76rem', color:'var(--primary)', fontWeight:700, display:'inline-flex', alignItems:'center', gap:4 }}><MdCheckCircle size={14}/> Actual</span>
                : cambiando===c.id
                  ? <MdRefresh size={14} style={{ color:'var(--text-muted)', animation:'spin 1s linear infinite' }}/>
                  : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── MainLayout ────────────────────────────────────────────────
export default function MainLayout() {
  const { user, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [collapsed, setCollapsed]       = useState(false)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    if (!user) navigate('/login', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (window.innerWidth <= 768) setCollapsed(true)
  }, [location.pathname])

  if (!user) return null

  const modulosMenu = useMemo(() => buildTree(user?.modulos ?? []), [user?.modulos])

  const visibleGroups = useMemo(() => {
    const roots = (modulosMenu || []).filter(n => n.ind_visible !== false)
    const grouped = {}
    GROUP_ORDER.forEach(g => { grouped[g] = [] })
    roots.forEach(n => {
      const g = grupoDeRuta(n.nombre_aplicacion)
      if (!grouped[g]) grouped[g] = []
      grouped[g].push(n)
    })
    return GROUP_ORDER
      .map(g => ({ label: g, items: (grouped[g] || []).sort((a,b) => (a.orden||0)-(b.orden||0)) }))
      .filter(g => g.items.length > 0)
  }, [modulosMenu])

  const currentItem = useMemo(() => {
    const all = (user?.modulos ?? []).find(m => m.nombre_aplicacion === location.pathname)
    return all ? { path: all.nombre_aplicacion, label: all.descripcion, group: grupoDeRuta(all.nombre_aplicacion) } : null
  }, [location.pathname, user?.modulos])

  const pageLabel = useMemo(() => {
    return currentItem?.label || location.pathname.replace('/', '').replace(/-/g, ' ') || 'Pander'
  }, [currentItem, location.pathname])

  const handleLogout = () => { logout(); navigate('/login', { replace: true }) }

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ── */}
      <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
        {/* Logo */}
        <div className={styles.sidebarLogo}>
          <img src={logo} alt="Pander" style={{ height: 28, objectFit:'contain' }} />
          {!collapsed && <span className={styles.logoText}>Pander</span>}
          <button className={styles.collapseBtn} onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <MdChevronRight size={16}/> : <MdChevronLeft size={16}/>}
          </button>
        </div>

        {/* Usuario */}
        {!collapsed && (
          <div className={styles.userChip}>
            <div className={styles.userAvatar}>
              {(user.nombre || user.login)[0].toUpperCase()}
            </div>
            <div className={styles.userInfo}>
              <span className={styles.userName}>{user.nombre || user.login}</span>
              <span className={styles.userRole}>{user.rol_descripcion || 'Usuario'}</span>
            </div>
          </div>
        )}

        {/* Menú dinámico */}
        <nav className={styles.nav}>
          {visibleGroups.length === 0 ? (
            !collapsed && (
              <div style={{ padding:'12px 16px', color:'rgba(255,255,255,.4)', fontSize:'.8rem' }}>
                Sin modulos asignados
              </div>
            )
          ) : visibleGroups.map(group => (
            <div key={group.label} style={{ marginBottom: 6 }}>
              {!collapsed && (
                <div style={{ padding:'10px 12px 4px', fontSize:'.68rem', fontWeight:700,
                  color:'rgba(255,255,255,.45)', textTransform:'uppercase', letterSpacing:'.08em' }}>
                  {group.label}
                </div>
              )}
              {group.items.map(nodo => (
                <NavNode key={nodo.id} nodo={nodo} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </nav>

        {/* Logout */}
        <div className={styles.sidebarFooter}>
          <button className={styles.logoutBtn} onClick={handleLogout}
            title={collapsed ? 'Cerrar sesión' : undefined}>
            <MdLogout size={18}/>
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      {/* ── Content ── */}
      <div className={styles.content}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.menuBtn} onClick={() => setCollapsed(c => !c)} aria-label="Menú">
              <MdMenu size={22}/>
            </button>
            <span className={styles.topbarBreadcrumb}>
              <MdDashboard size={14} style={{ marginRight:4, verticalAlign:'middle' }}/>
              Pander
              {currentItem?.group && currentItem.group !== 'Inicio' && (
                <span> &rsaquo; {currentItem.group}</span>
              )}
              <span> &rsaquo; <strong>{pageLabel}</strong></span>
            </span>
          </div>
          <div className={styles.topbarRight}>
            <span style={{ padding:'4px 12px', borderRadius:99,
              background:'var(--primary-bg)', color:'var(--primary)',
              fontSize:'.79rem', fontWeight:600, border:'1px solid var(--primary-border)',
              display:'flex', alignItems:'center', gap:5 }}>
              <MdBusiness size={13}/>
              {user.compania_nombre || `Compañía #${user.compania}`}
            </span>
            {user.ind_super_usuario && (
              <button onClick={() => setSelectorOpen(true)} style={{
                padding:'6px 14px', borderRadius:99, border:'none',
                background:'var(--primary)', color:'#fff',
                fontFamily:'var(--font)', fontSize:'.81rem', fontWeight:600,
                cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                <MdSwapHoriz size={16}/> Cambiar Compañía
              </button>
            )}
            <span style={{ fontSize:'.76rem', color:'var(--text-muted)' }}>
              {time.toLocaleDateString('es-CO', { weekday:'short', day:'numeric', month:'short' })}
            </span>
          </div>
        </header>

        <main className={styles.page}><Outlet /></main>

        <footer className={styles.footer}>
          © 2026 Pander RRHH · Sistema de Gestión de Talento Humano
        </footer>
      </div>

      {selectorOpen && <SelectorCompania onClose={() => setSelectorOpen(false)} />}
    </div>
  )
}
