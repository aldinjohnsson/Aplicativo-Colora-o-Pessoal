import React from 'react'
import { Check, Loader, Lock } from 'lucide-react'
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 mb-4 sm:mb-6">
      <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Seu Progresso</h2>

      <div className="space-y-0">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1

          return (
            <div key={step.id} className="flex gap-3 sm:gap-4">
              {/* Icon column + vertical connector */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={cn(
                  'w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0',
                  step.completed
                    ? 'bg-green-100 text-green-600'
                    : step.current
                    ? 'bg-blue-100 text-blue-600'
                    : step.locked
                    ? 'bg-gray-100 text-gray-400'
                    : 'bg-gray-100 text-gray-600'
                )}>
                  {step.completed ? (
                    <Check className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : step.locked ? (
                    <Lock className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : step.current ? (
                    <Loader className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : (
                    <span className="text-xs font-bold">{step.id}</span>
                  )}
                </div>
                {/* Vertical connector */}
                {!isLast && (
                  <div className={cn(
                    'w-0.5 flex-1 mt-1 mb-1 min-h-[20px]',
                    step.completed ? 'bg-green-200' : 'bg-gray-200'
                  )} />
                )}
              </div>

              {/* Content */}
              <div className={cn('flex-1 min-w-0 flex items-start justify-between gap-2', !isLast ? 'pb-4' : 'pb-0')}>
                <div className="flex-1 min-w-0 pt-1">
                  <h3 className={cn(
                    'text-sm font-medium leading-tight',
                    step.current ? 'text-blue-600' : step.completed ? 'text-green-600' : 'text-gray-900'
                  )}>
                    {step.title}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug">{step.description}</p>
                </div>

                {/* Status badge */}
                <div className="flex-shrink-0 pt-1">
                  {step.completed && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 whitespace-nowrap">
                      Concluído
                    </span>
                  )}
                  {step.current && !step.completed && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap">
                      Em andamento
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}