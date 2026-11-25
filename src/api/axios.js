// src/api/axios.js
import axios from 'axios'

// En producción (Docker/Kubernetes) VITE_API_URL llega vacío: el navegador llama a la
// misma URL del sitio y el Ingress reparte /api hacia el backend.
// En desarrollo, si no existe la variable, se usa el backend local.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

// Interceptor de respuesta — manejo global de errores
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem('pander_session')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
