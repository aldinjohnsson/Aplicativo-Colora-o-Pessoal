// src/components/LandingPage.tsx
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Sparkles, ShieldCheck } from 'lucide-react'

const SWATCHES = [
  '#F7C5C5', '#F4A8A8', '#E87979', '#D85F5F',
  '#F9D4B6', '#F5B98A', '#E8925A', '#C97A44',
  '#D4E8D0', '#A8D4B0', '#6DB87D', '#4A9B5A',
  '#C5D4F0', '#A0B8E8', '#6A8FD4', '#4A6FBC',
  '#E8D0F0', '#D0A8E8', '#B07DD4', '#8A55BC',
  '#F0E8C5', '#E8D48A', '#D4BC55', '#B89A35',
]

export function LandingPage() {
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)
  const [hovered, setHovered] = useState<'client' | 'admin' | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#faf8f5',
        fontFamily: "'Georgia', 'Times New Roman', serif",
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* ── Decorative background blobs ── */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
      }}>
        <div style={{
          position: 'absolute', top: '-10%', right: '-5%',
          width: 500, height: 500,
          background: 'radial-gradient(circle, rgba(233,30,99,0.08) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', bottom: '-15%', left: '-8%',
          width: 600, height: 600,
          background: 'radial-gradient(circle, rgba(255,152,0,0.06) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '20%',
          width: 300, height: 300,
          background: 'radial-gradient(circle, rgba(103,58,183,0.04) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
      </div>

      {/* ── Swatch strip top ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 5, zIndex: 10,
        display: 'flex',
        opacity: mounted ? 1 : 0,
        transition: 'opacity 1s ease 0.2s',
      }}>
        {SWATCHES.map((color, i) => (
          <div key={i} style={{ flex: 1, background: color }} />
        ))}
      </div>

      {/* ── Main content ── */}
      <div style={{
        position: 'relative', zIndex: 1,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 24px 40px',
      }}>

        {/* Logo mark */}
        <div style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
          marginBottom: 48,
          textAlign: 'center',
        }}>
          {/* Color palette icon */}
          <div style={{
            width: 80, height: 80,
            margin: '0 auto 20px',
            position: 'relative',
          }}>
            {/* Circular swatches */}
            {[
              { color: '#E87979', angle: 0 },
              { color: '#E8925A', angle: 60 },
              { color: '#F5D060', angle: 120 },
              { color: '#6DB87D', angle: 180 },
              { color: '#6A8FD4', angle: 240 },
              { color: '#B07DD4', angle: 300 },
            ].map(({ color, angle }, i) => {
              const rad = (angle * Math.PI) / 180
              const r = 28
              const x = 40 + r * Math.cos(rad)
              const y = 40 + r * Math.sin(rad)
              return (
                <div key={i} style={{
                  position: 'absolute',
                  width: 18, height: 18,
                  borderRadius: '50%',
                  background: color,
                  top: y - 9, left: x - 9,
                  border: '2px solid white',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  opacity: mounted ? 1 : 0,
                  transition: `opacity 0.4s ease ${0.3 + i * 0.08}s`,
                }} />
              )
            })}
            {/* Center dot */}
            <div style={{
              position: 'absolute',
              width: 24, height: 24,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #e91e63, #ff6090)',
              top: 28, left: 28,
              boxShadow: '0 4px 16px rgba(233,30,99,0.4)',
            }} />
          </div>

          <h1 style={{
            margin: 0,
            fontSize: 'clamp(32px, 6vw, 52px)',
            fontWeight: 400,
            letterSpacing: '-0.5px',
            color: '#1a1a1a',
            lineHeight: 1,
          }}>
            MS <span style={{
              fontStyle: 'italic',
              color: '#e91e63',
            }}>Colors</span>
          </h1>
          <p style={{
            margin: '10px 0 0',
            fontSize: 14,
            letterSpacing: '4px',
            textTransform: 'uppercase',
            color: '#999',
            fontFamily: "'Helvetica Neue', Arial, sans-serif",
            fontWeight: 300,
          }}>
            Análise de Coloração Pessoal
          </p>
        </div>

        {/* Divider */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          marginBottom: 48,
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.6s ease 0.5s',
        }}>
          <div style={{ width: 60, height: 1, background: 'linear-gradient(to right, transparent, #ddd)' }} />
          <span style={{
            fontSize: 11, letterSpacing: '3px', color: '#bbb',
            fontFamily: "'Helvetica Neue', Arial, sans-serif",
            textTransform: 'uppercase',
          }}>Bem-vinda</span>
          <div style={{ width: 60, height: 1, background: 'linear-gradient(to left, transparent, #ddd)' }} />
        </div>

        {/* Cards */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          width: '100%',
          maxWidth: 420,
        }}>

          {/* Client Card */}
          <button
            onClick={() => navigate('/acesso')}
            onMouseEnter={() => setHovered('client')}
            onMouseLeave={() => setHovered(null)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'block',
              background: hovered === 'client'
                ? 'linear-gradient(135deg, #e91e63, #ff6090)'
                : 'white',
              border: '1.5px solid',
              borderColor: hovered === 'client' ? 'transparent' : '#eee',
              borderRadius: 20,
              padding: '28px 32px',
              boxShadow: hovered === 'client'
                ? '0 20px 60px rgba(233,30,99,0.3)'
                : '0 4px 24px rgba(0,0,0,0.06)',
              transform: hovered === 'client' ? 'translateY(-3px) scale(1.01)' : 'translateY(0) scale(1)',
              transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              opacity: mounted ? 1 : 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: hovered === 'client'
                    ? 'rgba(255,255,255,0.2)'
                    : 'linear-gradient(135deg, rgba(233,30,99,0.1), rgba(255,96,144,0.1))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Sparkles
                    size={22}
                    color={hovered === 'client' ? 'white' : '#e91e63'}
                  />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <p style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 600,
                    color: hovered === 'client' ? 'white' : '#1a1a1a',
                    fontFamily: "'Georgia', serif",
                    transition: 'color 0.2s',
                  }}>
                    Área da Cliente
                  </p>
                  <p style={{
                    margin: '3px 0 0',
                    fontSize: 13,
                    color: hovered === 'client' ? 'rgba(255,255,255,0.8)' : '#999',
                    fontFamily: "'Helvetica Neue', Arial, sans-serif",
                    fontWeight: 300,
                    transition: 'color 0.2s',
                  }}>
                    Acesse sua análise de coloração
                  </p>
                </div>
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: hovered === 'client' ? 'rgba(255,255,255,0.2)' : '#fef0f4',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transform: hovered === 'client' ? 'translateX(3px)' : 'translateX(0)',
                transition: 'all 0.3s ease',
                flexShrink: 0,
              }}>
                <ArrowRight size={16} color={hovered === 'client' ? 'white' : '#e91e63'} />
              </div>
            </div>

            {/* Color strip inside card */}
            <div style={{
              marginTop: 20,
              height: 6,
              borderRadius: 3,
              overflow: 'hidden',
              display: 'flex',
              opacity: hovered === 'client' ? 0.4 : 1,
              transition: 'opacity 0.3s ease',
            }}>
              {['#F7C5C5','#F9D4B6','#F0E8C5','#D4E8D0','#C5D4F0','#E8D0F0','#F4A8A8','#E8925A'].map((c, i) => (
                <div key={i} style={{ flex: 1, background: c }} />
              ))}
            </div>
          </button>

          {/* Admin Card */}
          <button
            onClick={() => navigate('/admin/login')}
            onMouseEnter={() => setHovered('admin')}
            onMouseLeave={() => setHovered(null)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'block',
              background: hovered === 'admin' ? '#1a1a2e' : 'white',
              border: '1.5px solid',
              borderColor: hovered === 'admin' ? 'transparent' : '#eee',
              borderRadius: 20,
              padding: '28px 32px',
              boxShadow: hovered === 'admin'
                ? '0 20px 60px rgba(26,26,46,0.3)'
                : '0 4px 24px rgba(0,0,0,0.06)',
              transform: hovered === 'admin' ? 'translateY(-3px) scale(1.01)' : 'translateY(0) scale(1)',
              transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              opacity: mounted ? 1 : 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: hovered === 'admin'
                    ? 'rgba(255,255,255,0.1)'
                    : 'rgba(26,26,46,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <ShieldCheck
                    size={22}
                    color={hovered === 'admin' ? 'rgba(255,255,255,0.9)' : '#1a1a2e'}
                  />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <p style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 600,
                    color: hovered === 'admin' ? 'white' : '#1a1a1a',
                    fontFamily: "'Georgia', serif",
                    transition: 'color 0.2s',
                  }}>
                    Painel Administrativo
                  </p>
                  <p style={{
                    margin: '3px 0 0',
                    fontSize: 13,
                    color: hovered === 'admin' ? 'rgba(255,255,255,0.5)' : '#999',
                    fontFamily: "'Helvetica Neue', Arial, sans-serif",
                    fontWeight: 300,
                    transition: 'color 0.2s',
                  }}>
                    Acesso restrito à consultora
                  </p>
                </div>
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: hovered === 'admin' ? 'rgba(255,255,255,0.1)' : '#f5f5f5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transform: hovered === 'admin' ? 'translateX(3px)' : 'translateX(0)',
                transition: 'all 0.3s ease',
                flexShrink: 0,
              }}>
                <ArrowRight size={16} color={hovered === 'admin' ? 'rgba(255,255,255,0.7)' : '#555'} />
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <p style={{
          marginTop: 48,
          fontSize: 12,
          color: '#ccc',
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          letterSpacing: '1px',
          textAlign: 'center',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.6s ease 0.9s',
        }}>
          © {new Date().getFullYear()} MS Colors · Todos os direitos reservados
        </p>
      </div>

      {/* ── Swatch strip bottom ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: 5, zIndex: 10,
        display: 'flex',
        opacity: mounted ? 1 : 0,
        transition: 'opacity 1s ease 0.2s',
      }}>
        {[...SWATCHES].reverse().map((color, i) => (
          <div key={i} style={{ flex: 1, background: color }} />
        ))}
      </div>
    </div>
  )
}
