import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function InsufficientCreditsModal({ 
  isOpen, 
  onClose, 
  remainingCredits, 
  jobCost,
  mode = 'approval',
  onKeepImages,
  onClearImages,
  providerName
}) {
  const [showKeepPrompt, setShowKeepPrompt] = useState(false);

  if (!isOpen) return null;

  const handleReturnToJson = () => {
    setShowKeepPrompt(true);
  };

  const handleKeep = () => {
    setShowKeepPrompt(false);
    if (onKeepImages) onKeepImages();
  };

  const handleClear = () => {
    setShowKeepPrompt(false);
    if (onClearImages) onClearImages();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={18} />
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
              <AlertTriangle size={22} className="text-rose-500" />
            </div>
          </div>
        </div>

        {!showKeepPrompt ? (
          <>
            {/* Title */}
            <h3 className="text-center text-lg font-bold text-slate-800 mb-2">
              Insufficient {providerName ? `${providerName} Credits` : 'Credits'}
            </h3>

            {/* Body */}
            <p className="text-center text-sm text-slate-500 mb-6 leading-relaxed">
              You don't have enough {providerName ? providerName : ''} credits to complete this action. Please top up your balance to continue.
              {remainingCredits !== undefined && remainingCredits !== null && (
                <span className="block mt-2 text-xs text-slate-400">
                  Current balance: <span className="font-semibold text-slate-600">${typeof remainingCredits === 'number' ? remainingCredits.toFixed(2) : remainingCredits}</span>
                  {jobCost !== undefined && (
                    <> · Estimated cost: <span className="font-semibold text-slate-600">${typeof jobCost === 'number' ? jobCost.toFixed(2) : jobCost}</span></>
                  )}
                </span>
              )}
            </p>

            {/* Actions */}
            <div className="space-y-3">
              {mode === 'variant' ? (
                <button
                  onClick={handleReturnToJson}
                  className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 transition-colors"
                >
                  Return to JSON Review
                </button>
              ) : null}
              <button
                onClick={onClose}
                className="w-full py-2.5 text-slate-500 font-semibold text-sm hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Keep/Clear prompt */}
            <h3 className="text-center text-lg font-bold text-slate-800 mb-2">
              Keep Generated Images?
            </h3>
            <p className="text-center text-sm text-slate-500 mb-6 leading-relaxed">
              You don't have enough credits to continue. The images generated so far have already been created — do you want to keep them, or clear them from this job?
              <span className="block mt-2 text-xs text-amber-600 font-medium">
                Note: Clearing images only removes the files. Credits already spent are not refunded.
              </span>
            </p>
            <div className="space-y-3">
              <button
                onClick={handleKeep}
                className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm hover:bg-emerald-700 transition-colors"
              >
                Keep Images
              </button>
              <button
                onClick={handleClear}
                className="w-full py-2.5 border border-rose-300 text-rose-600 rounded-lg font-semibold text-sm hover:bg-rose-50 transition-colors"
              >
                Clear All Images
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
