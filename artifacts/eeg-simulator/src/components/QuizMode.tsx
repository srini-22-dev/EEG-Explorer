import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { PATTERN_BY_ID } from '../utils/patterns';
import { PatientState } from '../utils/eegGenerator';

type QuizModeProps = {
  onClose: () => void;
  setPatientState: (s: PatientState) => void;
  setActivePatterns: (p: Set<string>) => void;
  setFreeze: (f: boolean) => void;
};

export function QuizMode({ onClose, setPatientState, setActivePatterns, setFreeze }: QuizModeProps) {
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [questionPhase, setQuestionPhase] = useState<'recording' | 'guessing' | 'result'>('recording');
  const [currentPatternId, setCurrentPatternId] = useState<string>('');
  const [options, setOptions] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<string>('');
  
  const generateQuestion = () => {
    const allPatterns = Object.keys(PATTERN_BY_ID);
    const target = allPatterns[Math.floor(Math.random() * allPatterns.length)];
    setCurrentPatternId(target);
    
    const opts = new Set<string>([target]);
    while(opts.size < 4) {
      opts.add(allPatterns[Math.floor(Math.random() * allPatterns.length)]);
    }
    setOptions(Array.from(opts).sort(() => Math.random() - 0.5));
    
    setActivePatterns(new Set([target]));
    setFreeze(false);
    setQuestionPhase('recording');
    
    setTimeout(() => {
      setFreeze(true);
      setQuestionPhase('guessing');
    }, 4000);
  };
  
  useEffect(() => {
    generateQuestion();
    return () => setFreeze(false);
  }, []);
  
  const handleGuess = (opt: string) => {
    setSelectedOption(opt);
    setQuestionPhase('result');
    setTotal(t => t + 1);
    if (opt === currentPatternId) {
      setScore(s => s + 1);
    }
  };
  
  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center pointer-events-auto">
      <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg shadow-xl w-[450px] text-slate-200">
        <h2 className="text-xl font-bold mb-4 text-emerald-400">Pattern Quiz Mode</h2>
        <div className="mb-4 text-sm text-slate-400">Score: {score} / {total}</div>
        
        {questionPhase === 'recording' && (
          <div className="text-center py-8 text-lg animate-pulse">
            Recording EEG data...
          </div>
        )}
        
        {questionPhase === 'guessing' && (
          <div className="space-y-2">
            <p className="mb-4">Identify the active pattern:</p>
            {options.map(opt => (
              <Button 
                key={opt}
                variant="outline"
                className="w-full justify-start border-slate-700 text-slate-300 hover:bg-slate-800 h-auto py-2 whitespace-normal text-left"
                onClick={() => handleGuess(opt)}
              >
                {PATTERN_BY_ID[opt].name}
              </Button>
            ))}
          </div>
        )}
        
        {questionPhase === 'result' && (
          <div className="space-y-4">
            <div className={`text-lg font-bold ${selectedOption === currentPatternId ? 'text-emerald-500' : 'text-red-500'}`}>
              {selectedOption === currentPatternId ? 'Correct!' : 'Incorrect'}
            </div>
            <p className="text-sm">
              The pattern was: <strong className="text-white">{PATTERN_BY_ID[currentPatternId].name}</strong>
            </p>
            <p className="text-xs text-slate-400">
              {PATTERN_BY_ID[currentPatternId].desc}
            </p>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={generateQuestion}>
              Next Question
            </Button>
          </div>
        )}
        
        <div className="mt-6 pt-4 border-t border-slate-700">
          <Button variant="ghost" className="w-full text-slate-400 hover:text-white" onClick={onClose}>
            Exit Quiz Mode
          </Button>
        </div>
      </div>
    </div>
  );
}
