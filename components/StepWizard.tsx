import React from 'react';
import { Check, Circle } from 'lucide-react';

interface StepWizardProps {
  currentStep: 'config' | 'exercise' | 'analysis' | 'reinforcement';
}

export const StepWizard: React.FC<StepWizardProps> = ({ currentStep }) => {
  const steps = [
    { id: 'config', label: 'Configuration' },
    { id: 'exercise', label: 'Exercice' },
    { id: 'analysis', label: 'Correction' },
    { id: 'reinforcement', label: 'Pratique' },
  ];

  const getStepStatus = (id: string) => {
    const stepIds = steps.map(s => s.id);
    const currentIndex = stepIds.indexOf(currentStep);
    const stepIndex = stepIds.indexOf(id);

    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    return 'upcoming';
  };

  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-center space-x-2 md:space-x-8">
        {steps.map((step, index) => {
          const status = getStepStatus(step.id);
          return (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors duration-300
                ${status === 'completed' ? 'bg-indigo-600 border-indigo-600 text-white' : ''}
                ${status === 'current' ? 'border-indigo-600 text-indigo-600 bg-white' : ''}
                ${status === 'upcoming' ? 'border-gray-300 text-gray-300 bg-white' : ''}
              `}>
                {status === 'completed' ? <Check size={16} /> : <span>{index + 1}</span>}
              </div>
              <span className={`ml-2 text-sm font-medium hidden sm:block
                ${status === 'current' ? 'text-indigo-900' : 'text-gray-500'}
              `}>
                {step.label}
              </span>
              {index < steps.length - 1 && (
                <div className={`hidden sm:block w-8 h-0.5 ml-4 ${status === 'completed' ? 'bg-indigo-600' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
