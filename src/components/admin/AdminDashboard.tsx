import React, { useState } from 'react'
import { Button } from '../ui/Button'
import { Card, CardContent, CardHeader } from '../ui/Card'
import { ClientsAndFilesManager } from './ClientsAndFilesManager'
import { ContractEditor } from './ContractEditor'
import { FormEditor } from './FormEditor'
import SettingsEditor from './SettingsEditor'
import { 
  Users, 
  FileText, 
  ClipboardList, 
  Settings,
  Palette,
  ArrowLeft
} from 'lucide-react'

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('clients')

  const tabs = [
    { id: 'clients', label: 'Clientes e Arquivos', icon: Users },
    { id: 'contract', label: 'Contrato', icon: FileText },
    { id: 'form', label: 'Formulário', icon: ClipboardList },
    { id: 'settings', label: 'Configurações', icon: Settings },
  ]

  const goToClient = () => {
    window.location.href = '/client'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center mr-3">
                <Palette className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Painel Administrativo</h1>
                <p className="text-sm text-gray-500">Gestão do Sistema</p>
              </div>
            </div>
            <Button variant="ghost" onClick={goToClient}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar ao Cliente
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <div className="lg:w-64 flex-shrink-0">
            <Card>
              <CardContent className="p-0">
                <nav className="space-y-1">
                  {tabs.map((tab) => {
                    const Icon = tab.icon
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center px-4 py-3 text-left text-sm font-medium rounded-lg transition-colors ${
                          activeTab === tab.id
                            ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-5 w-5 mr-3" />
                        {tab.label}
                      </button>
                    )
                  })}
                </nav>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="flex-1">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-gray-900">
                  {tabs.find(t => t.id === activeTab)?.label}
                </h2>
              </CardHeader>
              <CardContent>
                {activeTab === 'clients' && <ClientsAndFilesManager />}
                {activeTab === 'contract' && <ContractEditor />}
                {activeTab === 'form' && <FormEditor />}
                {activeTab === 'settings' && <SettingsEditor />}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}