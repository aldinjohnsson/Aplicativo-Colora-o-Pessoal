import React from 'react'
import { Check, Circle, Lock } from 'lucide-react'
import { cn } from '../../lib/utils'

interface Step {
  id: number
  title: string
  description: string
  completed: boolean
  current: boolean
  locked: boolean
}

interface ProgressIndicatorProps {
  steps: Step[]
}

export function ProgressIndicator({ steps }: ProgressIndicatorProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Seu Progresso</h2>
      
      <div className="space-y-4">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            {/* Step Icon */}
            <div className={cn(
              "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
              step.completed 
                ? "bg-green-100 text-green-600" 
                : step.current 
                ? "bg-blue-100 text-blue-600"
                : step.locked
                ? "bg-gray-100 text-gray-400"
                : "bg-gray-100 text-gray-600"
            )}>
              {step.completed ? (
                <Check className="h-5 w-5" />
              ) : step.locked ? (
                <Lock className="h-5 w-5" />
              ) : (
                <Circle className="h-5 w-5" />
              )}
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div className={cn(
                "absolute left-5 mt-10 h-6 w-0.5",
                step.completed ? "bg-green-200" : "bg-gray-200"
              )} />
            )}

            {/* Step Content */}
            <div className="ml-4 flex-1">
              <h3 className={cn(
                "text-sm font-medium",
                step.current ? "text-blue-600" : step.completed ? "text-green-600" : "text-gray-900"
              )}>
                {step.title}
              </h3>
              <p className="text-sm text-gray-500">{step.description}</p>
            </div>

            {/* Status Badge */}
            {step.completed && (
              <div className="flex-shrink-0">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Concluído
                </span>
              </div>
            )}
            {step.current && !step.completed && (
              <div className="flex-shrink-0">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  Em Andamento
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}