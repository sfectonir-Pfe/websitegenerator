import React, { useState } from 'react';

interface PromptInputProps {
  onSubmit: (code: string) => void; // Callback to update the page content
  isLoading: boolean;
  placeholder: string;
  currentCode: string; // Current HTML code of the page
}

const PromptInput: React.FC<PromptInputProps> = ({ onSubmit, isLoading, placeholder, currentCode }) => {
  const [prompt, setPrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('La prompt ne peut pas être vide.');
      return;
    }

    try {
      setError(null);
      const response = await fetch('http://localhost:5000/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentCode, // Include the current code in the request
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erreur inconnue.');
      }

      const data = await response.json();
      if (!data.code || typeof data.code !== 'string') {
        throw new Error('Le backend a retourné une réponse invalide.');
      }

      onSubmit(data.code); // Update the page content only on success
      setPrompt('');
    } catch (error: any) {
      setError(error.message || 'Erreur lors de la génération du code.');
      // Do not call onSubmit, ensuring the page retains its last valid state
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={placeholder}
        className="flex-1 p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
        disabled={isLoading}
      />
      {error && (
        <div className="text-red-500 text-sm" role="alert" aria-live="assertive">
          <p>{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-blue-500 underline hover:text-blue-700"
          >
            Réessayer
          </button>
        </div>
      )}
      <button
        type="submit"
        className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition disabled:opacity-50"
        disabled={isLoading}
      >
        {isLoading ? 'Chargement...' : 'Soumettre'}
      </button>
    </form>
  );
};

export default PromptInput;