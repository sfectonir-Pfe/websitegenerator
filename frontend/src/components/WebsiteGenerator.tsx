
'use client';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { debounce } from 'lodash';
import JSZip from 'jszip';
import CodeEditor from './CodeEditor';
import LivePreview from './LivePreview';
import axios from 'axios';

interface Page {
  code: string;
  theme: string;
}

interface Pages {
  [key: string]: Page;
}

// Define PromptInput component with voice prompt functionality
interface PromptInputProps {
  onSubmit: (value: string) => void;
  isLoading: boolean;
  placeholder?: string;
  submitLabel?: string;
}

interface PromptAnalysis {
  action: 'add' | 'modify' | 'remove';
  target:
    | 'banner'
    | 'section'
    | 'form'
    | 'product'
    | 'image'
    | 'text'
    | 'button'
    | 'navbar'
    | 'footer'
    | 'custom';
  content?: string;
  style?: {
    color?: string;
    background?: string;
    fontSize?: string;
    alignment?: 'left' | 'center' | 'right';
    animation?: 'fade-in' | 'slide-in' | 'none';
  };
  applyToAll: boolean;
}

const PromptInput: React.FC<PromptInputProps> = ({

  onSubmit,
  isLoading,
  placeholder = 'Enter your prompt...',
  submitLabel = 'Submit',
}) => {
  const [value, setValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', blob, 'prompt.webm');

        try {
          const response = await fetch('http://localhost:5000/api/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Transcription failed: ${response.status} - ${errorText}`
            );
          }

          const { text } = await response.json();
          setValue(text);
          setIsRecording(false);
          if (text.trim()) onSubmit(text);
        } catch (error) {
          console.error('Transcription error:', error);
          alert('Failed to transcribe. Try again.');
          setIsRecording(false);
        } finally {
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (error) {
      console.error('Microphone error:', error);
      alert('Microphone access denied. Check permissions.');
    }
  };

  const stopRecording = () => {
    mediaRecorder?.stop();
    setMediaRecorder(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isLoading) return;
    onSubmit(value);
    setValue('');
  };

  return (
    <div className="flex items-center space-x-2 w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 bg-gray-900/80 text-gray-200 rounded-lg border border-purple-600/50 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 text-sm transition-all duration-300"
        disabled={isLoading || isRecording}
      />
      <button
        type="button"
        className={`px-3 py-2 ${
          isRecording ? 'bg-red-600' : 'bg-blue-600'
        } text-white rounded-full hover:shadow-glow transition-all duration-300 disabled:opacity-50 text-sm`}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isLoading}
      >
        {isRecording ? 'Stop' : '🎙️'}
      </button>
      <button
        type="submit"
        className="px-3 py-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 hover:shadow-glow transition-all duration-300 disabled:opacity-50 text-sm"
        disabled={isLoading || !value.trim() || isRecording}
        onClick={handleSubmit}
      >
        {submitLabel}
      </button>
    </div>
  );
};

interface PageData {
  code: string;
  theme: string;
}

interface PageHistory {
  code: string;
  theme: string;
}

interface FolderStructure {
  [path: string]: {
    type: 'file' | 'folder';
    name: string;
    children?: FolderStructure;
  };
}

// Helper to convert all <img> tags with local src to <img src="">
function cleanLocalImgSrc(html: string): string {
  return html.replace(
    /<img([^>]*?)src=['"]((?!http)(?!data:)[^'"]*\\.(jpg|jpeg|png|webp|gif))['"]([^>]*)>/gi,
    '<img$1src=""$4>'
  );
}

const WebsiteGenerator: React.FC = () => {
  const [imageMetadata, setImageMetadata] = useState<{ [key: string]: { url: string; source: string; query: string; attribution: string }[] }>({
  'index.html': [],
});
  
  
  const [themesByFolder, setThemesByFolder] = useState<{ [folder: string]: string }>({
    '': 'digital', // Thème par défaut pour le dossier racine
  });
  const [globalPrompts, setGlobalPrompts] = useState<string[]>([]);
  const [pages, setPages] = useState<{ [key: string]: PageData }>({
    'index.html': {
      code: getDefaultPageCode('index.html', 'Home', [], 'digital'),
      theme: 'digital',
    },
  });
  const [currentPage, setCurrentPage] = useState<string>('index.html');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [currentNavTheme, setCurrentNavTheme] = useState<string>('digital');
  const [initialPages, setInitialPages] = useState<{ [key: string]: PageData }>({
    'index.html': {
      code: getDefaultPageCode('index.html', 'Home', [], 'digital'),
      theme: 'digital',
    },
  });
  const [codeHistory, setCodeHistory] = useState<{
    [key: string]: PageHistory[];
  }>({
    'index.html': [
      { code: getDefaultPageCode('index.html', 'Home', [], 'digital'), theme: 'digital' },
    ],
  });
  const [historyIndex, setHistoryIndex] = useState<{ [key: string]: number }>({
    'index.html': 0,
  });
  const [expandedFolders, setExpandedFolders] = useState<{
    [key: string]: boolean;
  }>({});
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  
  const getFolderPath = (pagePath: string): string => {
    const parts = pagePath.split('/');
    parts.pop(); // Retirer le nom de fichier
    return parts.join('/');
  };
  const updateFolderTheme = (folder: string, newTheme: string) => {
    setThemesByFolder((prev) => ({ ...prev, [folder]: newTheme }));
  
    const updatedPages = { ...pages };
    Object.keys(pages).forEach((pagePath) => {
      if (getFolderPath(pagePath) === folder) {
        updatedPages[pagePath] = {
          ...updatedPages[pagePath],
          theme: newTheme,
          code: getDefaultPageCode(
            pagePath,
            pagePath.split('/').pop()!.replace('.html', ''),
            Object.keys(pages).filter((p) => getFolderPath(p) === folder),
            newTheme
          ),
        };
      }
    });
    setPages(updatedPages);
    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'dragDropUpdate' && event.data.updatedHTML) {
          console.log('Received dragDropUpdate:', event.data.updatedHTML);
          const cleanedCode = cleanCode(event.data.updatedHTML, currentPage);
          setPages((prev) => ({
            ...prev,
            [currentPage]: { ...prev[currentPage], code: cleanedCode },
          }));
          setCodeHistory((prev) => {
            const currentHistory = prev[currentPage] || [];
            const currentIndex = historyIndex[currentPage] || 0;
            const newHistory = currentHistory.slice(0, currentIndex + 1);
            newHistory.push({
              code: cleanedCode,
              theme: pages[currentPage].theme,
            });
            return {
              ...prev,
              [currentPage]: newHistory,
            };
          });
          setHistoryIndex((prev) => ({
            ...prev,
            [currentPage]: (historyIndex[currentPage] || 0) + 1,
          }));
        }
      };
    
      window.addEventListener('message', handleMessage);
      return () => {
        window.removeEventListener('message', handleMessage);
      };
    }, [currentPage, pages, cleanCode, historyIndex]);
  };
  
  function getDefaultPageCode(
    pageName: string,
    pageTitle: string,
    siblingPages: string[],
    theme: string
  ): string {
    const navigationLinks = siblingPages
      .filter((page) => page !== pageName)
      .map(
        (page) =>
          `<a href="${page}" style="margin: 0 1.5rem; text-decoration: none; color: #333333; font-weight: 600; font-size: 1.1rem; transition: all 0.3s ease;">${page.replace(
            '.html',
            ''
          )}</a>`
      )
      .join('');
  
    const fontLink =
      '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=Montserrat:wght@400;600&display=swap" rel="stylesheet">';
  
    // Define a unique navbar style per page
    const getNavStyle = (pageName: string) => {
      let navBg, navColor;
      switch (pageName) {
        case 'index.html':
          navBg = 'rgba(255, 255, 255, 0.9)';
          navColor = '#333333';
          break;
        case 'about.html':
          navBg = 'rgba(245, 245, 245, 0.9)';
          navColor = '#333333';
          break;
        case 'contact.html':
          navBg = 'rgba(240, 240, 240, 0.9)';
          navColor = '#333333';
          break;
        default:
          navBg = 'rgba(255, 255, 255, 0.9)';
          navColor = '#333333';
      }
      return { navBg, navColor };
    };
  
    const { navBg, navColor } = getNavStyle(pageName);
  
    return `
  <!DOCTYPE html>
  <html lang="utf-8">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle} - WebCraft</title>
    ${fontLink}
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: 'Montserrat', sans-serif;
        background: #ffffff; /* White background */
        color: #333333; /* Dark text for readability */
        position: relative;
        overflow-x: hidden;
        line-height: 1.8;
      }
      nav {
        position: sticky;
        top: 0;
        background: ${navBg};
        backdrop-filter: blur(10px);
        padding: 1.5rem 2rem;
        text-align: center;
        border-bottom: 1px solid rgba(138, 74, 243, 0.2); /* Violet border */
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); /* Softer shadow */
        z-index: 1000;
      }
      nav a {
        color: ${navColor};
        text-decoration: none;
        margin: 0 1.5rem;
        font-weight: 600;
        font-size: 1.1rem;
        transition: all 0.3s ease;
      }
      nav a:hover {
        color: #8a4af3; /* Rich violet hover */
        transform: translateY(-2px);
        display: inline-block;
      }
      nav a.active {
        color: #8a4af3;
        border-bottom: 2px solid #8a4af3;
        padding-bottom: 0.2rem;
      }
      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 0;
      }
      .hero-section {
        position: relative;
        padding: 8rem 2rem;
        text-align: center;
        background: linear-gradient(135deg, #f5f5f5, #ffffff); /* Light gradient */
        border-bottom: 1px solid rgba(138, 74, 243, 0.2);
      }
      .hero-section h1 {
        font-family: 'Playfair Display', serif;
        font-size: 4.5rem;
        font-weight: 700;
        color: #8a4af3; /* Rich violet for heading */
        margin-bottom: 1.5rem;
        animation: fadeIn 1.5s ease-in-out;
        letter-spacing: 1px;
      }
      .hero-section p {
        font-size: 1.3rem;
        font-weight: 400;
        color: #555555; /* Medium gray for paragraphs */
        margin: 1.5rem 0;
        animation: fadeInUp 1.5s ease-in-out;
        max-width: 700px;
        margin-left: auto;
        margin-right: auto;
      }
      .hero-section button {
        background: linear-gradient(90deg, #8a4af3, #c47aff); /* Violet to light violet gradient */
        color: #ffffff;
        padding: 1rem 3rem;
        border: none;
        border-radius: 8px;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        animation: fadeInUp 1.5s ease-in-out;
        box-shadow: 0 4px 15px rgba(138, 74, 243, 0.3);
      }
      .hero-section button:hover {
        transform: translateY(-5px);
        box-shadow: 0 6px 20px rgba(138, 74, 243, 0.5), 0 0 25px rgba(138, 74, 243, 0.3);
        background: linear-gradient(90deg, #c47aff, #8a4af3);
      }
      .features-section {
        padding: 5rem 2rem;
        background: #ffffff; /* White background */
      }
      .features-section h2 {
        font-family: 'Playfair Display', serif;
        font-size: 2.8rem;
        font-weight: 700;
        color: #8a4af3; /* Rich violet */
        text-align: center;
        margin-bottom: 3rem;
        animation: fadeIn 1.5s ease-in-out;
        letter-spacing: 0.5px;
      }
      .features-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 2rem;
        max-width: 1280px;
        margin: 0 auto;
      }
      .feature-card {
        background: rgba(245, 245, 245, 0.9); /* Light gray for cards */
        backdrop-filter: blur(10px);
        padding: 2.5rem;
        border-radius: 12px;
        border: 1px solid rgba(138, 74, 243, 0.2);
        transition: all 0.3s ease;
        animation: fadeInUp 1.5s ease-in-out;
      }
      .feature-card:hover {
        transform: translateY(-10px);
        border-color: #8a4af3;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1), 0 0 20px rgba(138, 74, 243, 0.2);
      }
      .feature-card h3 {
        font-family: 'Playfair Display', serif;
        font-size: 1.8rem;
        font-weight: 500;
        color: #8a4af3;
        margin-bottom: 1rem;
        letter-spacing: 0.5px;
      }
      .feature-card p {
        font-size: 1rem;
        font-weight: 400;
        color: #555555;
      }
      footer {
        background: linear-gradient(180deg, #e0e0e0, #ffffff); /* Light gradient for footer */
        color: #666666;
        padding: 2rem 0;
        text-align: center;
        border-top: 1px solid rgba(138, 74, 243, 0.2);
      }
      footer a {
        color: #8a4af3;
        text-decoration: none;
        transition: all 0.3s ease;
      }
      footer a:hover {
        color: #c47aff;
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
  </head>
  <body>
    <nav>
      ${navigationLinks}
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          const currentPage = '${pageName}';
          document.querySelectorAll('nav a').forEach(link => {
            if (link.getAttribute('href') === currentPage) {
              link.classList.add('active');
            }
          });
        });
      </script>
    </nav>
    <main>
      ${pageName === 'index.html' ? `
        <section class="hero-section">
          <h1>WebCraft</h1>
          <p>Create your own website using our advanced platform, which is designed to make it easy to build a professional-looking and creative website.</p>
          <button>find out about our services</button>
        </section>
        <section class="features-section">
          <h2>Our offerings</h2>
          <div class="features-grid">
            <div class="feature-card">
              <h3>Web Development</h3>
              <p>Creation of customized websites, optimized for your business objectives.</p>
            </div>
            <div class="feature-card">
              <h3>Refined design</h3>
              <p>Modern, intuitive interfaces for an exceptional user experience.</p>
            </div>
            <div class="feature-card">
              <h3>Advanced Performance</h3>
              <p>Cutting-edge technologies for fast, reliable sites.</p>
            </div>
          </div>
        </section>
      ` : `
        <section class="content-section">
          <h1>Bienvenue sur ${pageTitle}</h1>
          <p>Contenu personnalisé pour ${pageName.replace('.html', '')}.</p>
        </section>
      `}
    </main>
    ${getFooter(theme, pageName)}
  </body>
  </html>`;
  }
  
  function getThemeColors(theme: string, pageName: string) {
    return {
      navBg: 'linear-gradient(90deg, #ffffff, #e0e0e0)', // Light gradient for nav
      navLink: '#333333', // Dark links for readability
      navActive: 'linear-gradient(90deg, #e0e0e0, #d1d5db)', // Subtle active link color
      bodyBg: '#ffffff', // White background
      text: '#333333', // Dark text for contrast
      heading: '#8a4af3', // Rich violet for headings
      linkHover: '#c47aff', // Light violet hover
      heroBg: 'linear-gradient(135deg, #f5f5f5, #ffffff)', // Light gradient for hero
      secondaryText: '#555555', // Medium gray for secondary text
      cardBg: 'linear-gradient(135deg, #f5f5f5, #ffffff)', // Light gradient for cards
      footerBg: 'linear-gradient(180deg, #e0e0e0, #ffffff)', // Light gradient for footer
      footerText: '#666666', // Darker gray for footer text
      footerLink: '#8a4af3', // Rich violet for footer links
      footerLinkHover: '#c47aff', // Light violet hover for footer links
    };
  }
  
  function getIndexStyles(): string {
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: 'Montserrat', sans-serif;
        line-height: 1.8;
        color: #333333; /* Dark text for readability */
        background: #ffffff; /* White background */
        position: relative;
        overflow-x: hidden;
      }
      body::before {
        content: '';
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, rgba(200, 200, 200, 0.1), rgba(200, 200, 200, 0.05)); /* Subtle light gradient */
        z-index: -1;
        animation: backgroundPulse 10s infinite alternate;
      }
      @keyframes backgroundPulse {
        0% {
          opacity: 0.8;
          transform: scale(1);
        }
        100% {
          opacity: 1;
          transform: scale(1.05);
        }
      }
      nav {
        background: linear-gradient(90deg, #ffffff, #e0e0e0); /* Light gradient for nav */
        padding: 1rem 2rem;
        position: sticky;
        top: 0;
        z-index: 1000;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1); /* Softer shadow */
      }
      nav a {
        color: #333333;
        font-weight: 600;
        font-size: 1.1rem;
        margin-right: 1.5rem;
        text-decoration: none;
        transition: transform 0.3s ease, color 0.3s ease;
      }
      nav a:hover {
        transform: scale(1.1);
        color: #8a4af3; /* Rich violet hover */
      }
      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 3rem 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      h1 {
        font-family: 'Playfair Display', serif;
        color: #8a4af3; /* Rich violet */
        font-size: 3.5rem;
        margin-bottom: 1rem;
        background: linear-gradient(90deg, #8a4af3, #c47aff); /* Violet to light violet gradient */
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: fadeIn 1.5s ease-in-out;
      }
      p {
        font-family: 'Montserrat', sans-serif;
        color: #555555;
        font-size: 1.3rem;
        margin: 1rem 0;
        animation: fadeInUp 1.5s ease-in-out;
      }
      button {
        background: linear-gradient(90deg, #8a4af3, #c47aff); /* Violet to light violet gradient */
        color: white;
        padding: 0.8rem 2rem;
        border: none;
        border-radius: 8px;
        font-size: 1.2rem;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        margin-top: 2rem;
      }
      button:hover {
        transform: translateY(-4px);
        box-shadow: 0 6px 20px rgba(138, 74, 243, 0.3); /* Violet shadow */
      }
      button:active {
        transform: translateY(1px);
        box-shadow: none;
      }
      footer {
        background: linear-gradient(180deg, #e0e0e0, #ffffff);
        color: #666666;
        padding: 2rem 0;
        text-align: center;
        border-top: 1px solid rgba(138, 74, 243, 0.2);
      }
      footer a {
        color: #8a4af3;
        text-decoration: none;
        transition: color 0.3s ease;
      }
      footer a:hover {
        color: #c47aff;
      }
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
  }
  
  function getFooter(theme: string, pageName: string): string {
    const colors = getThemeColors(theme, pageName);
    const footerStyles = `
      background: ${colors.footerBg};
      color: ${colors.footerText};
      text-align: center;
      padding: 2rem 0;
      border-top: 1px solid rgba(138, 74, 243, 0.2);
    `;
    const pStyles = `
      font-size: 0.9rem;
      margin: 0.3rem 0;
      font-weight: 400;
    `;
    const aStyles = `
      color: ${colors.footerLink};
      text-decoration: none;
      transition: color 0.3s ease;
    `;
    const additionalStyles = `
      a:hover {
        color: ${colors.footerLinkHover};
      }
    `;
  
    return `
      <footer style="${footerStyles}">
        <p style="${pStyles}">© 2025 WebCraft - All Rights Reserved</p>
        <p style="${pStyles}">
          <a href="mailto:support@WebCraft.com" style="${aStyles}">support@WebCraft.com</a>
        </p>
        <style>${additionalStyles}</style>
      </footer>
    `;
  }
  const injectDragDropScript = (): string => {
    return `
      document.addEventListener('DOMContentLoaded', () => {
        // Ensure elements that should be draggable are marked
        document.querySelectorAll('section, div.feature-card, button, h1, h2, h3, p').forEach(element => {
          if (!element.hasAttribute('draggable')) {
            element.setAttribute('draggable', 'true');
          }
          if (!element.id) {
            element.id = 'draggable-' + Math.random().toString(36).substr(2, 9);
          }
        });
  
        document.querySelectorAll('[draggable="true"]').forEach(element => {
          element.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', element.id);
          });
        });
  
        document.addEventListener('dragover', (e) => e.preventDefault());
  
        document.addEventListener('drop', (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('text/plain');
          const draggedElement = document.getElementById(id);
          const targetElement = e.target.closest('section, div.features-grid, main');
          if (draggedElement && targetElement && draggedElement !== targetElement) {
            targetElement.appendChild(draggedElement);
            // Send the updated HTML to the parent
            window.parent.postMessage({ 
              type: 'dragDropUpdate', 
              updatedHTML: document.documentElement.outerHTML 
            }, '*');
          }
        });
      });
    `;
  };
  
  
  const getNavBar = (pageList: string[], currentPage: string, theme: string): string => {
    const navStyles = theme.toLowerCase() === 'digital'
      ? 'background: linear-gradient(90deg, #2a2a2a, #333333); padding: 1rem;'
      : 'background: #333; padding: 1rem;';
    const linkStyles = 'color: #e0e0e0; margin-right: 1rem; text-decoration: none;';
    const hoverStyles = theme.toLowerCase() === 'digital'
      ? 'a:hover { color: #bb86fc; }'
      : 'a:hover { color: #007bff; }';
  
    const links = pageList.map((page) => {
      const pageName = page.replace('.html', '');
      const isActive = page === currentPage ? 'font-weight: bold;' : '';
      return `<a href="${page}" style="${linkStyles} ${isActive}">${pageName}</a>`;
    }).join('');
  
    return `
      <nav style="${navStyles}" data-theme="${theme}">
        ${links}
        <style>${hoverStyles}</style>
      </nav>
    `;
  };
  
  const processHTML = (html: string, pageList: string[], currentPage: string, pages: Pages): string => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
  
      const body = doc.querySelector('body');
      const footer = doc.querySelector('footer');
  
      if (!doc.querySelector('script[data-navigation-handler]')) {
        const script = doc.createElement('script');
        script.setAttribute('data-navigation-handler', 'true');
        script.textContent = `
          document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('a[href$=".html"]').forEach(link => {
              link.addEventListener('click', e => {
                e.preventDefault();
                const href = link.getAttribute('href');
                window.parent.postMessage({ type: 'navigation', href }, '*');
              });
            });
          });
        `;
        if (body) {
          if (footer) {
            body.insertBefore(script, footer);
          } else {
            body.appendChild(script);
          }
        }
      }
  
      if (!doc.querySelector('script[data-drag-drop-handler]')) {
        const dragDropScript = doc.createElement('script');
        dragDropScript.setAttribute('data-drag-drop-handler', 'true');
        dragDropScript.textContent = injectDragDropScript();
        if (body) {
          if (footer) {
            body.insertBefore(dragDropScript, footer);
          } else {
            body.appendChild(dragDropScript);
          }
        }
      }
  
      const nav = doc.querySelector('nav');
      if (nav && pageList.length > 0) {
        const theme = pages[currentPage]?.theme || 'digital';
        nav.outerHTML = getNavBar(pageList, currentPage, theme);
      }
  
      return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    } catch (err) {
      console.error('Error processing HTML:', err);
      throw new Error('Invalid HTML content');
    }
  };

  const cleanCode = useCallback(
    (htmlCode: string, pageName: string): string => {
      // Step 1: Isolate the HTML content (from <!DOCTYPE html> to </html>)
      let cleaned = htmlCode
        .replace(/^[\s\S]*?(<!DOCTYPE html[\s\S]*?<\/html>)/i, '$1') // Keep only from <!DOCTYPE html> to </html>
        .replace(/```html\n|```/g, '') // Remove markdown code fences
        .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML comments
        .trim();
  
      // Step 2: Parse the HTML to manipulate the DOM
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleaned, 'text/html');
  
      // Step 3: Remove explanatory text within <body>
      const body = doc.querySelector('body');
      if (body) {
        const meaningfulTags = ['h1', 'h2', 'h3', 'nav', 'div', 'section', 'article', 'aside', 'footer', 'script'];
        const children = Array.from(body.childNodes);
  
        children.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const textContent = node.textContent?.trim();
            if (
              textContent &&
              textContent.match(
                /This code creates|This HTML page is designed|description|note|explanation|generated by|Here is|Modifications|Explications|modified|modifié/i
              )
            ) {
              node.remove();
            }
          } else if (node.nodeName.toLowerCase() === 'p') {
            const textContent = node.textContent?.trim();
            if (
              textContent &&
              textContent.match(
                /This code creates|This HTML page is designed|description|note|explanation|generated by|Here is|Modifications|Explications|modified|modifié/i
              )
            ) {
              node.remove();
            }
          }
        });
  
        let foundMeaningfulTag = false;
        Array.from(body.childNodes).forEach((node) => {
          const tagName = node.nodeName.toLowerCase();
          if (meaningfulTags.includes(tagName)) {
            foundMeaningfulTag = true;
          } else if (!foundMeaningfulTag && (node.nodeType === Node.TEXT_NODE || tagName === 'p')) {
            node.remove();
          }
        });
  
        // Step 4: Ensure footer is the last element in <body>
        let footer = doc.querySelector('footer');
        if (!footer) {
          // If no footer exists, add one
          footer = doc.createElement('footer');
          footer.innerHTML = getFooter(pages[pageName]?.theme || 'digital', pageName);
          body.appendChild(footer);
        } else {
          // Remove the existing footer and re-append it at the end
          footer.remove();
          body.appendChild(footer);
        }
  
        // Step 5: Move any elements after the footer (e.g., scripts) before the footer
        const bodyChildren = Array.from(body.childNodes);
        const footerIndex = bodyChildren.findIndex((node) => node.nodeName.toLowerCase() === 'footer');
        const elementsAfterFooter = bodyChildren.slice(footerIndex + 1);
        elementsAfterFooter.forEach((node) => {
          node.remove();
          body.insertBefore(node, footer);
        });
      }
  
      // Step 6: Ensure essential HTML structure
      if (!doc.querySelector('html')) {
        cleaned = '<!DOCTYPE html>\n<html lang="en">\n' + doc.documentElement.innerHTML + '\n</html>';
      } else {
        cleaned = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
      }
  
      if (!doc.querySelector('head')) {
        cleaned = cleaned.replace(
          '<html',
          '<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>\n'
        );
      }
  
      if (!doc.querySelector('body')) {
        cleaned = cleaned.replace('</head>', '</head>\n<body>\n') + '\n</body>';
      }
  
      // Step 7: Update title with page name
      cleaned = cleaned.replace(
        /<title>.*?<\/title>/gi,
        `<title>${pageName.split('/').pop()!.replace('.html', '')} - website</title>`
      );
  
      // Step 8: Ensure styles are included
      if (!doc.querySelector('style')) {
        const defaultStyles = getIndexStyles();
        cleaned = cleaned.replace(
          '</head>',
          `<style>${defaultStyles}</style>\n</head>`
        );
      }
  
      // Step 9: Ensure the code ends with </html>
      if (!cleaned.endsWith('</html>')) {
        cleaned = cleaned + '\n</html>';
      }
  
      return cleaned;
    },
    [pages] // Added dependency to match the original context where getFooter uses pages
  );

  const isPromptForAllPages = (prompt: string): boolean => {
    const lowerPrompt = prompt.toLowerCase();
    return (
      lowerPrompt.includes('all pages') ||
      lowerPrompt.includes('every page') ||
      lowerPrompt.includes('everywhere') ||
      lowerPrompt.includes('globally') ||
      lowerPrompt.includes('site-wide') ||
      lowerPrompt.includes('toutes les pages') 
    );
  };

  const handleBack = useCallback(() => {
    const currentIndex = historyIndex[currentPage] || 0;
    if (currentIndex <= 0) return;

    const newIndex = currentIndex - 1;
    const previousState = codeHistory[currentPage][newIndex];
    setPages((prev) => ({
      ...prev,
      [currentPage]: { code: previousState.code, theme: previousState.theme },
    }));
    setCurrentNavTheme(previousState.theme);
    setHistoryIndex((prev) => ({
      ...prev,
      [currentPage]: newIndex,
    }));
  }, [currentPage, codeHistory, historyIndex]);

  const handleForward = useCallback(() => {
    const currentIndex = historyIndex[currentPage] || 0;
    const historyLength = codeHistory[currentPage]?.length || 0;
    if (currentIndex >= historyLength - 1) return;

    const newIndex = currentIndex + 1;
    const nextState = codeHistory[currentPage][newIndex];
    setPages((prev) => ({
      ...prev,
      [currentPage]: { code: nextState.code, theme: nextState.theme },
    }));
    setCurrentNavTheme(nextState.theme);
    setHistoryIndex((prev) => ({
      ...prev,
      [currentPage]: newIndex,
    }));
  }, [currentPage, codeHistory, historyIndex]);

  const handleRefresh = useCallback(() => {
    if (!initialPages[currentPage]) return;
    const refreshedPages = {
      ...pages,
      [currentPage]: { ...initialPages[currentPage] },
    };
    setPages(refreshedPages);
    setCodeHistory((prev) => ({
      ...prev,
      [currentPage]: [
        {
          code: initialPages[currentPage].code,
          theme: initialPages[currentPage].theme,
        },
      ],
    }));
    setHistoryIndex((prev) => ({
      ...prev,
      [currentPage]: 0,
    }));
  }, [pages, currentPage, initialPages]);

  const analyzePrompt = (prompt: string): PromptAnalysis => {
    const lowerPrompt = prompt.toLowerCase();
    let action: PromptAnalysis['action'] = 'add';
    let target: PromptAnalysis['target'] = 'custom';
    let content = prompt;
    const style: PromptAnalysis['style'] = {};
    const applyToAll = isPromptForAllPages(prompt);

    if (
      lowerPrompt.includes('remove') ||
      lowerPrompt.includes('supprimer') ||
      lowerPrompt.includes('delete') ||
      lowerPrompt.includes('effacer')
    ) {
      action = 'remove';
    } else if (
      lowerPrompt.includes('modify') ||
      lowerPrompt.includes('modifier') ||
      lowerPrompt.includes('change') ||
      lowerPrompt.includes('changer')
    ) {
      action = 'modify';
    }

    if (lowerPrompt.includes('banner') || lowerPrompt.includes('bannière')) {
      target = 'banner';
    } else if (
      lowerPrompt.includes('form') ||
      lowerPrompt.includes('formulaire') ||
      lowerPrompt.includes('contact')
    ) {
      target = 'form';
    } else if (
      lowerPrompt.includes('product') ||
      lowerPrompt.includes('produit') ||
      lowerPrompt.includes('collection')
    ) {
      target = 'product';
    } else if (
      lowerPrompt.includes('image') ||
      lowerPrompt.includes('picture') ||
      lowerPrompt.includes('photo')
    ) {
      target = 'image';
    } else if (
      lowerPrompt.includes('text') ||
      lowerPrompt.includes('texte') ||
      lowerPrompt.includes('paragraph') ||
      lowerPrompt.includes('paragraphe')
    ) {
      target = 'text';
    } else if (
      lowerPrompt.includes('button') ||
      lowerPrompt.includes('bouton')
    ) {
      target = 'button';
    } else if (
      lowerPrompt.includes('navbar') ||
      lowerPrompt.includes('navigation') ||
      lowerPrompt.includes('menu')
    ) {
      target = 'navbar';
    } else if (
      lowerPrompt.includes('footer') ||
      lowerPrompt.includes('pied de page')
    ) {
      target = 'footer';
    } else if (
      lowerPrompt.includes('section') ||
      lowerPrompt.includes('welcome') ||
      lowerPrompt.includes('about') ||
      lowerPrompt.includes('home')
    ) {
      target = 'section';
    }

    if (lowerPrompt.includes('color') || lowerPrompt.includes('couleur')) {
      if (lowerPrompt.includes('red') || lowerPrompt.includes('rouge'))
        style.color = '#dc2626';
      else if (lowerPrompt.includes('blue') || lowerPrompt.includes('bleu'))
        style.color = '#3b82f6';
      else if (lowerPrompt.includes('green') || lowerPrompt.includes('vert'))
        style.color = '#22c55e';
    }
    if (lowerPrompt.includes('background') || lowerPrompt.includes('fond')) {
      if (lowerPrompt.includes('dark') || lowerPrompt.includes('sombre'))
        style.background = '#1f2937';
      else if (lowerPrompt.includes('light') || lowerPrompt.includes('clair'))
        style.background = '#f8fafc';
    }
    if (
      lowerPrompt.includes('font size') ||
      lowerPrompt.includes('taille de police')
    ) {
      if (lowerPrompt.includes('large') || lowerPrompt.includes('grand'))
        style.fontSize = '1.5rem';
      else if (lowerPrompt.includes('small') || lowerPrompt.includes('petit'))
        style.fontSize = '0.9rem';
    }
    if (lowerPrompt.includes('align') || lowerPrompt.includes('alignement')) {
      if (lowerPrompt.includes('center') || lowerPrompt.includes('centre'))
        style.alignment = 'center';
      else if (lowerPrompt.includes('left') || lowerPrompt.includes('gauche'))
        style.alignment = 'left';
      else if (lowerPrompt.includes('right') || lowerPrompt.includes('droite'))
        style.alignment = 'right';
    }
    if (lowerPrompt.includes('animation')) {
      if (lowerPrompt.includes('fade') || lowerPrompt.includes('fondu'))
        style.animation = 'fade-in';
      else if (lowerPrompt.includes('slide') || lowerPrompt.includes('glisser'))
        style.animation = 'slide-in';
      else if (lowerPrompt.includes('none') || lowerPrompt.includes('aucun'))
        style.animation = 'none';
    }

    const contentMatch = prompt.match(/"([^"]+)"/) || prompt.match(/'([^']+)'/);
    if (contentMatch) {
      content = contentMatch[1];
    } else if (target === 'text' || target === 'banner' || target === 'button') {
      content = prompt
        .replace(
          /(add|modify|remove|text|banner|button|texte|bannière|bouton)\s*/gi,
          ''
        )
        .trim();
    }

    return { action, target, content, style, applyToAll };
  };

  const flattenStructureForBackend = (structure: FolderStructure, parentPath: string = '') => {
    const hierarchy: any[] = [];
    Object.entries(structure).forEach(([name, item]) => {
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      const entry: any = {
        name,
        type: item.type,
        path: fullPath,
      };
      if (item.type === 'folder' && item.children) {
        entry.children = flattenStructureForBackend(item.children, fullPath).filter(
          (child: any) => child.type === 'file'
        );
      }
      hierarchy.push(entry);
    });
    return hierarchy;
  };

  const updateHierarchy = async (newStructure: FolderStructure) => {
    try {
      const hierarchy = flattenStructureForBackend(newStructure);
      console.log('Sending hierarchy to backend:', hierarchy);

      const response = await fetch('http://127.0.0.1:5000/api/update-hierarchy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ hierarchy }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server response error:', errorText);
        throw new Error('Failed to update hierarchy on the server');
      }

      const data = await response.json();
      console.log('Hierarchy updated successfully:', data);
    } catch (error: any) {
      console.error('Error updating hierarchy:', error.message);
      alert('Error updating hierarchy. Please check the logs.');
    }
  };

  const debouncedUpdateHierarchy = debounce(updateHierarchy, 500);
const handlePromptSubmit = useCallback(
  debounce(async (prompt: string) => {
    if (!prompt.trim()) {
      alert('The prompt cannot be empty.');
      return;
    }

    setIsLoading(true);
    try {
      console.log('Processing prompt:', prompt);
      const promptAnalysis = analyzePrompt(prompt);
      const htmlPages = Object.keys(pages).filter((page) =>
        page.endsWith('.html')
      );
      const targets = promptAnalysis.applyToAll ? htmlPages : [currentPage];
      let updatedPages = { ...pages };
      let newTheme = currentNavTheme;

      // Extract image queries from the prompt (e.g., "add an image of a forest")
      const imageQueryMatch = prompt.toLowerCase().match(/add an image of ([\w\s]+)/i);
      const imageQuery = imageQueryMatch ? imageQueryMatch[1].trim() : null;

      for (const targetPage of targets) {
        const response = await fetch('http://localhost:5000/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `Action: ${promptAnalysis.action}, Target: ${promptAnalysis.target}, Content: "${promptAnalysis.content}", Style: ${JSON.stringify(
              promptAnalysis.style
            )}, Ensure that all CSS styles are integrated into the HTML page within a <style> tag in the <head> section. Ensure the <footer> element is the last child of the <body> tag, with no elements appended after it.`,
            currentCode: pages[targetPage].code,
            existingPages: htmlPages,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error || `HTTP Error ${response.status} generating page ${targetPage}.`;
          throw new Error(errorMessage);
        }

        let data = await response.json();
        console.log('Backend Response:', data);

        if (!data.code) {
          throw new Error(`Invalid response for ${targetPage}: "code" field missing.`);
        }

        let cleanedCode = cleanCode(data.code, targetPage);

        // If the prompt includes an image query, fetch images
        if (imageQuery) {
          try {
            const imageResponse = await fetch('http://localhost:5000/api/add-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                currentCode: pages[targetPage].code,
                pagePath: targetPage,
                imageQueries: [imageQuery],
                siteType: pages[targetPage].theme
              }),
            });

            if (!imageResponse.ok) throw new Error('Failed to fetch images');

            const imageData = await imageResponse.json();
            cleanedCode = cleanCode(imageData.code, targetPage);

            // Update image metadata
            setImageMetadata((prev) => ({
              ...prev,
              [targetPage]: [...(prev[targetPage] || []), ...imageData.images]
            }));
          } catch (error) {
            console.error('Error fetching images:', error);
            // Fallback to placeholder if image fetch fails
            cleanedCode = cleanedCode.replace(
              /<img[^>]*src=["'][^"']*["'][^>]*>/g,
              (match) => match.replace(/src=["'][^"']*["']/, 'src="https://via.placeholder.com/300"')
            );
          }
        }

        if (!cleanedCode.includes('<style>')) {
          const defaultStyles = getIndexStyles();
          cleanedCode = cleanedCode.replace(
            '</head>',
            `<style>${defaultStyles}</style>\n</head>`
          );
        }
        newTheme = prompt.toLowerCase().includes('digital')
          ? 'digital'
          : 'digital';

        updatedPages = {
          ...updatedPages,
          [targetPage]: { code: cleanedCode, theme: newTheme },
        };

        setCodeHistory((prev) => {
          const currentHistory = prev[targetPage] || [];
          const currentIndex = historyIndex[targetPage] || 0;
          const newHistory = currentHistory.slice(0, currentIndex + 1);
          newHistory.push({ code: cleanedCode, theme: newTheme });
          return {
            ...prev,
            [targetPage]: newHistory,
          };
        });
        setHistoryIndex((prev) => ({
          ...prev,
          [targetPage]: (historyIndex[targetPage] || 0) + 1,
        }));
      }

      setPages(updatedPages);
      setCurrentNavTheme(newTheme);

      if (promptAnalysis.applyToAll) {
        setGlobalPrompts((prev) => [...prev, prompt]);
      }

      setPromptHistory((prev) => [...prev, prompt]);
    } catch (error) {
      console.error('Error during generation:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Error during generation due to network issue. Activating local simulation.';
      alert(errorMessage);
      simulateGeneration(prompt);
    } finally {
      setIsLoading(false);
    }
  }, 500),
  [currentPage, pages, cleanCode, currentNavTheme, globalPrompts, historyIndex, setImageMetadata]
);
const simulateGeneration = useCallback(
  (prompt: string) => {
    const newTheme = 'digital';
    const htmlPages = Object.keys(pages).filter((page) =>
      page.endsWith('.html')
    );
    const targets = isPromptForAllPages(prompt) ? htmlPages : [currentPage];
    let updatedPages = { ...pages };

    for (const targetPage of targets) {
      const pageTitle = targetPage.split('/').pop()!.replace('.html', '');
      let newCode = getDefaultPageCode(targetPage, pageTitle, htmlPages, newTheme);

      // Apply a simulated modification based on the prompt
      const promptAnalysis = analyzePrompt(prompt);
      if (promptAnalysis.action === 'add' && promptAnalysis.target === 'button') {
        newCode = newCode.replace(
          '</section>',
          `<button style="background-color: ${promptAnalysis.style?.color || '#dc2626'}; padding: 0.5rem 1rem; border: none; border-radius: 4px; color: white;">${promptAnalysis.content || 'New Button'}</button>\n</section>`
        );
      } else if (promptAnalysis.action === 'add' && promptAnalysis.target === 'image') {
        // Simulate adding an image with a placeholder
        const placeholderImageUrl = 'https://via.placeholder.com/300?text=Simulated+Image';
        newCode = newCode.replace(
          '</section>',
          `<img src="${placeholderImageUrl}" alt="Simulated Image" style="max-width: 100%; height: auto;" />\n</section>`
        );

        // Update imageMetadata for the simulated image
        setImageMetadata((prev) => {
          const currentImages = prev[targetPage] || [];
          const updatedImages = [
            ...currentImages,
            {
              url: placeholderImageUrl,
              source: 'placeholder',
              query: promptAnalysis.content || 'simulated',
              attribution: 'Placeholder Image',
            },
          ];
          return {
            ...prev,
            [targetPage]: updatedImages,
          };
        });
      }

      updatedPages = {
        ...updatedPages,
        [targetPage]: { code: newCode, theme: newTheme },
      };

      setCodeHistory((prev) => {
        const currentHistory = prev[targetPage] || [];
        const currentIndex = historyIndex[targetPage] || 0;
        const newHistory = currentHistory.slice(0, currentIndex + 1);
        newHistory.push({ code: newCode, theme: newTheme });
        return {
          ...prev,
          [targetPage]: newHistory,
        };
      });
      setHistoryIndex((prev) => ({
        ...prev,
        [targetPage]: (historyIndex[targetPage] || 0) + 1,
      }));
    }

    setPages(updatedPages);
    setCurrentNavTheme(newTheme);
  },
  [pages, currentPage, historyIndex, setImageMetadata]
);
const handleAddPage = useCallback(
  async (folderPath: string = '') => {
    let pageName = prompt('Enter the name of the new page (e.g., contact):')?.trim();
    if (!pageName) return;

    if (!pageName.toLowerCase().endsWith('.html')) pageName += '.html';
    if (!/^[a-zA-Z0-9_-]+\.html$/.test(pageName)) {
      alert('Invalid name. Use letters, numbers, hyphens, or underscores.');
      return;
    }

    const fullPageName = folderPath ? `${folderPath}/${pageName}` : pageName;

    if (pages[fullPageName]) {
      alert('This page already exists!');
      return;
    }

    setIsLoading(true);
    try {
      const pageList = Object.keys(pages)
        .filter((page) => page.endsWith('.html'))
        .concat(fullPageName);

      const response = await fetch('http://localhost:5000/api/add-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageName: fullPageName,
          prompt: `Generate a modern and responsive web page named '${fullPageName}' with content appropriate for the page name. Ensure that all CSS styles are integrated into the HTML page within a <style> tag in the <head> section. Include a navigation bar with links to all other pages in the website. The page should be visually appealing and user-friendly.`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error generating page.');
      }

      const data = await response.json();
      let newCode =
        data.code ||
        getDefaultPageCode(
          fullPageName,
          pageName.replace('.html', ''),
          pageList,
          currentNavTheme
        );

      if (!newCode.includes('<style>')) {
        const defaultStyles = getIndexStyles();
        newCode = newCode.replace(
          '</head>',
          `<style>${defaultStyles}</style>\n</head>`
        );
      }

      let finalCode = newCode;
      for (const prompt of globalPrompts) {
        const globalResponse = await fetch('http://localhost:5000/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `Modify the page with this prompt: "${prompt}". Ensure that all CSS styles are integrated into the HTML page within a <style> tag in the <head> section.`,
            currentCode: finalCode,
            existingPages: pageList,
          }),
        });

        if (!globalResponse.ok)
          throw new Error('Error applying global prompts.');

        const globalData = await globalResponse.json();
        if (!globalData.code)
          throw new Error('Invalid response when applying global prompts.');

        finalCode = cleanCode(globalData.code, fullPageName);
        if (!finalCode.includes('<style>')) {
          const defaultStyles = getIndexStyles();
          finalCode = finalCode.replace(
            '</head>',
            `<style>${defaultStyles}</style>\n</head>`
          );
        }
      }

      // Génération GENERIQUE des queries d'images pour chaque <img>
      const parser = new DOMParser();
      const doc = parser.parseFromString(finalCode, 'text/html');
      const allImgs = Array.from(doc.querySelectorAll('img'));
      const imageQueries = allImgs.map(img => {
        if (img.getAttribute('alt') && img.getAttribute('alt')!.trim() !== '') {
          return img.getAttribute('alt')!.trim();
        }
        // Cherche un titre dans le parent ou les ancêtres proches
        let title = '';
        let parent = img.parentElement;
        while (parent && !title) {
          const h = parent.querySelector('h1,h2,h3,h4,h5,h6');
          if (h) title = h.textContent || '';
          parent = parent.parentElement;
        }
        return title || pageName.replace('.html', '');
      });

      // Appel au backend pour remplacer les images
      const formData = new FormData();
      formData.append('currentCode', finalCode);
      imageQueries.forEach(q => formData.append('imageQueries[]', q));
      formData.append('pagePath', pageName);

      const imageResponse = await fetch('http://localhost:5000/api/add-image', {
        method: 'POST',
        body: formData,
      });
      const imageData = await imageResponse.json();
      const codeWithImages = imageData.code;
      // Use codeWithImages to display or save the page
      setCurrentPage(fullPageName);
      setImageMetadata((prev) => ({
        ...prev,
        [fullPageName]: imageData.images || [],
      }));

      const updatedPages = {
        ...pages,
        [fullPageName]: { code: codeWithImages, theme: currentNavTheme },
      };

      setPages(updatedPages);
      setInitialPages((prev) => ({
        ...prev,
        [fullPageName]: { code: newCode, theme: currentNavTheme },
      }));
      setCodeHistory((prev) => ({
        ...prev,
        [fullPageName]: [{ code: newCode, theme: currentNavTheme }],
      }));
      setHistoryIndex((prev) => ({
        ...prev,
        [fullPageName]: 0,
      }));

      // Initialize imageMetadata for the new page in case of error
      setImageMetadata((prev) => ({
        ...prev,
        [fullPageName]: [],
      }));
      alert('Error creating page. Default content used.');
    } finally {
      setIsLoading(false);
    }
  },
  [pages, currentNavTheme, globalPrompts, cleanCode, setImageMetadata]
);

  const handleAddFolder = useCallback(async () => {
    let folderName = prompt(
      'Enter the name of the folder (e.g., assets):'
    )?.trim();
    if (!folderName) return;

    if (!/^[a-zA-Z0-9_-]+$/.test(folderName)) {
      alert('Invalid name. Use letters, numbers, hyphens, or underscores.');
      return;
    }
    if (pages[folderName]) {
      alert('This folder already exists!');
      return;
    }

    setIsLoading(true);
    try {
      const updatedPages = {
        ...pages,
        [folderName]: { code: '', theme: currentNavTheme },
      };

      setPages(updatedPages);
    } catch (error) {
      console.error('Error creating folder:', error);
      alert('Error creating folder.');
    } finally {
      setIsLoading(false);
    }
  }, [pages, currentNavTheme]);

  const handleDeletePage = useCallback(
    (pageName: string) => {
      if (pageName === 'index.html') {
        alert('The page index.html cannot be deleted!');
        return;
      }

      const isFolder = !pageName.endsWith('.html');
      if (isFolder) {
        const pagesInFolder = Object.keys(pages).filter(
          (key) => key.startsWith(`${pageName}/`) && key.endsWith('.html')
        );
        if (pagesInFolder.length > 0) {
          if (
            !confirm(
              `The folder ${pageName} contains ${pagesInFolder.length} page(s). Delete anyway?`
            )
          )
            return;
        }
      } else {
        if (
          Object.keys(pages).filter((key) => key.endsWith('.html')).length <= 1
        ) {
          alert('You cannot delete the last page!');
          return;
        }
      }

      if (!confirm(`Delete ${pageName}? This action is irreversible.`)) return;

      const updatedPages = { ...pages };
      const updatedCodeHistory = { ...codeHistory };
      const updatedHistoryIndex = { ...historyIndex };

      Object.keys(updatedPages).forEach((key) => {
        if (key === pageName || (isFolder && key.startsWith(`${pageName}/`))) {
          delete updatedPages[key];
          delete updatedCodeHistory[key];
          delete updatedHistoryIndex[key];
        }
      });

      let newCurrentPage = currentPage;
      if (
        currentPage === pageName ||
        (isFolder && currentPage.startsWith(`${pageName}/`))
      ) {
        newCurrentPage =
          Object.keys(updatedPages).filter((page) => page.endsWith('.html'))[0] ||
          'index.html';
        setCurrentPage(newCurrentPage);
      }

      setPages(updatedPages);
      setCodeHistory(updatedCodeHistory);
      setHistoryIndex(updatedHistoryIndex);
    },
    [pages, currentPage, codeHistory, historyIndex]
  );

  const handleRenamePage = useCallback(
    (oldPageName: string) => {
      let newPageName = prompt(
        `New name for ${oldPageName} (e.g., contact):`
      )?.trim();
      if (!newPageName) return;

      const isFolder = !oldPageName.endsWith('.html');
      if (isFolder) {
        if (!/^[a-zA-Z0-9_-]+$/.test(newPageName)) {
          alert('Invalid name. Use letters, numbers, hyphens, or underscores.');
          return;
        }
      } else {
        if (!newPageName.toLowerCase().endsWith('.html'))
          newPageName += '.html';
        if (!/^[a-zA-Z0-9_-]+\.html$/.test(newPageName)) {
          alert('Invalid name. Use letters, numbers, hyphens, or underscores.');
          return;
        }
      }

      const oldPathParts = oldPageName.split('/');
      const baseName = oldPathParts.pop()!;
      const oldDir = oldPathParts.join('/');
      const newFullPageName = oldDir ? `${oldDir}/${newPageName}` : newPageName;

      if (pages[newFullPageName]) {
        alert('A page or folder with this name already exists!');
        return;
      }

      const updatedPages = { ...pages };
      const updatedCodeHistory = { ...codeHistory };
      const updatedHistoryIndex = { ...historyIndex };

      Object.keys(updatedPages).forEach((key) => {
        if (key === oldPageName) {
          updatedPages[newFullPageName] = updatedPages[key];
          updatedCodeHistory[newFullPageName] = updatedCodeHistory[key];
          updatedHistoryIndex[newFullPageName] = updatedHistoryIndex[key];
          delete updatedPages[key];
          delete updatedCodeHistory[key];
          delete updatedHistoryIndex[key];
        } else if (isFolder && key.startsWith(`${oldPageName}/`)) {
          const newKey = key.replace(oldPageName, newPageName);
          updatedPages[newKey] = updatedPages[key];
          updatedCodeHistory[newKey] = updatedCodeHistory[key];
          updatedHistoryIndex[newKey] = updatedHistoryIndex[key];
          delete updatedPages[key];
          delete updatedCodeHistory[key];
          delete updatedHistoryIndex[key];
        }
      });

      let newCurrentPage = currentPage;
      if (currentPage === oldPageName) {
        newCurrentPage = newFullPageName;
      } else if (isFolder && currentPage.startsWith(`${oldPageName}/`)) {
        newCurrentPage = currentPage.replace(oldPageName, newPageName);
      }
      setCurrentPage(newCurrentPage);
      setPages(updatedPages);
      setCodeHistory(updatedCodeHistory);
      setHistoryIndex(updatedHistoryIndex);
    },
    [pages, currentPage, codeHistory, historyIndex]
  );

const handleAddImage = useCallback(
  async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.multiple = true;

    input.onchange = async (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      setIsLoading(true);
      
      try {
        const formData = new FormData();
        formData.append('currentCode', pages[currentPage].code);
        formData.append('pagePath', currentPage);
        formData.append('siteType', pages[currentPage].theme || 'generic');

        // Ajouter chaque fichier image
        Array.from(files).forEach((file) => {
          formData.append('images', file);
        });

        const response = await fetch('http://localhost:5000/api/add-image', {
          method: 'POST',
          body: formData,
          // Note: Ne pas ajouter manuellement le Content-Type pour FormData
          // Le navigateur le fera automatiquement avec le bon boundary
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server responded with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        if (!data.code) {
          throw new Error('Invalid response from server: missing HTML code');
        }

        // Nettoyer et mettre à jour le code
        const cleanedCode = cleanCode(data.code, currentPage);
        
        // Mettre à jour l'état des pages
        setPages(prev => ({
          ...prev,
          [currentPage]: { 
            ...prev[currentPage], 
            code: cleanedCode 
          }
        }));

        // Mettre à jour l'historique
        setCodeHistory(prev => {
          const currentHistory = prev[currentPage] || [];
          return {
            ...prev,
            [currentPage]: [
              ...currentHistory,
              {
                code: cleanedCode,
                theme: pages[currentPage].theme
              }
            ]
          };
        });

        // Mettre à jour les métadonnées des images
        if (data.images && data.images.length > 0) {
          setImageMetadata(prev => {
            const currentImages = prev[currentPage] || [];
            return {
              ...prev,
              [currentPage]: [
                ...currentImages,
                ...data.images.map((img: any) => ({
                  url: img.url,
                  source: 'upload',
                  query: '',
                  attribution: img.attribution || 'User uploaded image'
                }))
              ]
            };
          });
        }

      } catch (error) {
        console.error('Image upload error:', error);
        alert(`Failed to upload images: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        // Fallback: Ajouter des placeholders si l'upload échoue
        setPages(prev => {
          const currentCode = prev[currentPage].code;
          let updatedCode = currentCode;
          
          // Ajouter des balises img avec des placeholders
          for (let i = 0; i < files.length; i++) {
            const placeholder = `<img src="https://via.placeholder.com/300?text=Image+${i+1}" alt="Uploaded image ${i+1}" class="uploaded-image" />`;
            updatedCode = updatedCode.replace('</body>', `${placeholder}\n</body>`);
          }
          
          return {
            ...prev,
            [currentPage]: {
              ...prev[currentPage],
              code: updatedCode
            }
          };
        });

      } finally {
        setIsLoading(false);
      }
    };

    input.click();
  },
  [currentPage, pages, cleanCode]
);

  const handleExport = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const zip = new JSZip();

      const currentDir = currentPage.includes('/')
        ? currentPage.substring(0, currentPage.lastIndexOf('/'))
        : '';
      const isFolder = !currentPage.endsWith('.html');

      let pagesToExport: string[] = [];
      let zipName = '';

      if (isFolder) {
        pagesToExport = Object.keys(pages).filter(
          (key) => key.startsWith(`${currentPage}/`) && key.endsWith('.html')
        );
        zipName = `${currentPage}.zip`;
      } else if (currentDir) {
        pagesToExport = Object.keys(pages).filter(
          (key) => key.startsWith(`${currentDir}/`) && key.endsWith('.html')
        );
        zipName = `${currentDir}.zip`;
      } else {
        pagesToExport = Object.keys(pages).filter(
          (key) => !key.includes('/') && key.endsWith('.html')
        );
        zipName = 'website.zip';
      }

      if (pagesToExport.length === 0) {
        alert('No pages to export.');
        return;
      }

      const generateHeader = () => {
  const navigationLinks = pagesToExport
    .map(
      (page) =>
        `<a href="${page}" style="margin-right: 1rem; text-decoration: none; color: #f3e8ff; font-weight: 600; font-size: 1.1rem;">${page.replace(
          '.html',
          ''
        )}</a>`
    )
    .join('');

  return `
    <header style="
      background: linear-gradient(90deg, #6a0dad, #9370db); 
      padding: 1.5rem 2rem; 
      text-align: center; 
      border-bottom: 2px solid rgba(138, 43, 226, 0.5); 
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
    ">
      ${navigationLinks}
    </header>
  `;
};

      const header = generateHeader();

      pagesToExport.forEach((page) => {
        const folderPath = page.substring(0, page.lastIndexOf('/'));
        const fileName = page.split('/').pop()!;
        const folder = folderPath ? zip.folder(folderPath)! : zip;

        const pageContent = pages[page].code.replace(
          '<body>',
          `<body>\n${header}`
        );
        folder.file(fileName, pageContent);
      });

      zip.generateAsync({ type: 'blob' }).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      });
    },
    [currentPage, pages]
  );

  const handleAddMap = useCallback(
    async (address: string) => {
      setIsLoading(true);
      try {
        const geocodeResponse = await fetch('http://localhost:5000/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });
        if (!geocodeResponse.ok) {
          throw new Error('Failed to geocode address');
        }
        const { coordinates } = await geocodeResponse.json();
        const mapResponse = await fetch('http://localhost:5000/api/add-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentCode: pages[currentPage].code,
            lat: coordinates.lat,
            lng: coordinates.lng,
            zoom: 13,
          }),
        });
        if (!mapResponse.ok) {
          throw new Error('Failed to add map');
        }
        const { code } = await mapResponse.json();
        const cleanedCode = cleanCode(code, currentPage);
        setPages((prev) => ({
          ...prev,
          [currentPage]: { ...prev[currentPage], code: cleanedCode },
        }));
        setCodeHistory((prev) => {
          const currentHistory = prev[currentPage] || [];
          return {
            ...prev,
            [currentPage]: [
              ...currentHistory,
              {
                code: cleanedCode,
                theme: pages[currentPage].theme
              }
            ]
          };
        });
      } catch (error) {
        console.error('Error adding map:', error);
        alert('Failed to add map.');
      } finally {
        setIsLoading(false);
      }
    },
    [currentPage, pages, setIsLoading, setPages, setCodeHistory, cleanCode]
  );

  const folderStructure = useMemo(() => {
    const structure: FolderStructure = {};

    Object.keys(pages).forEach((path) => {
      const parts = path.split('/');
      let currentLevel = structure;

      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        const isFolder = !isLast || !path.endsWith('.html');

        if (!currentLevel[part]) {
          currentLevel[part] = {
            type: isFolder ? 'folder' : 'file',
            name: part,
          };

          if (isFolder) {
            currentLevel[part].children = {};
          }
        }

        if (!isLast && currentLevel[part].children) {
          currentLevel = currentLevel[part].children!;
        }
      });
    });

    const sortStructure = (struct: FolderStructure): FolderStructure => {
      const sorted: FolderStructure = {};
      const entries = Object.entries(struct).sort((a, b) => {
        const aIsFolder = a[1].type === 'folder';
        const bIsFolder = b[1].type === 'folder';
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;
        return a[0].localeCompare(b[0]);
      });

      entries.forEach(([key, value]) => {
        sorted[key] = { ...value };
        if (value.children) {
          sorted[key].children = sortStructure(value.children);
        }
      });

      return sorted;
    };

    return sortStructure(structure);
  }, [pages]);

  const flattenStructure = (structure: FolderStructure, parentPath: string = ''): { path: string, name: string, type: 'file' | 'folder' }[] => {
    let flat: { path: string, name: string, type: 'file' | 'folder' }[] = [];
    Object.entries(structure).forEach(([name, item]) => {
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      flat.push({ path: fullPath, name, type: item.type });
      if (item.children) {
        flat = flat.concat(flattenStructure(item.children, fullPath));
      }
    });
    return flat;
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, path: string) => {
    setDraggedItem(path);
    e.dataTransfer.setData('text/plain', path);
    e.currentTarget.classList.add('dragging');
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('dragging');
    e.currentTarget.classList.remove('drag-over');
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetPath: string) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (!draggedItem) return;
  
    const draggedId = draggedItem; // L'élément que vous déplacez
    if (draggedId === targetPath) return; // Évitez les boucles infinies
  
    const newStructure = JSON.parse(JSON.stringify(folderStructure)); // Copie profonde de la structure des dossiers
  
    // Fonction pour trouver un élément dans la structure
    const findNode = (
      structure: FolderStructure,
      path: string,
      parentPath: string = ''
    ): { parent: FolderStructure | null, key: string, node: FolderStructure[string] } | null => {
      for (const [key, item] of Object.entries(structure)) {
        const currentPath = parentPath ? `${parentPath}/${key}` : key;
        if (currentPath === path) {
          return { parent: structure, key, node: item };
        }
        if (item.children) {
          const result = findNode(item.children, path, currentPath);
          if (result) return result;
        }
      }
      return null;
    };
  
    const source = findNode(newStructure, draggedId);
    const target = targetPath ? findNode(newStructure, targetPath) : null;
  
    if (!source) return;
  
    const sourceParent = source.parent!;
    const sourceKey = source.key;
    const sourceNode = source.node;
  
    // Supprimez la source de son parent
    delete sourceParent[sourceKey];
  
    const sourceName = draggedId.split('/').pop()!;
  
    if (target) {
      const targetNode = target.node;
      const targetIsFolder = targetNode.type === 'folder';
      if (targetIsFolder) {
        // Déplacer dans un dossier
        if (!targetNode.children) targetNode.children = {};
        targetNode.children[sourceName] = sourceNode;
      }
    } else {
      // Déplacer à la racine
      newStructure[sourceName] = sourceNode;
    }
  
    // Mettez à jour les chemins des fichiers pour refléter les changements
    const updatedPages = { ...pages };
    const newPages: { [key: string]: PageData } = {};
    const oldBasePath = draggedId;
    const newBasePath = targetPath ? `${targetPath}/${sourceName}` : sourceName;
  
    Object.keys(updatedPages).forEach((oldPath) => {
      if (oldPath === draggedId || oldPath.startsWith(`${draggedId}/`)) {
        const relativePath = oldPath.substring(draggedId.length);
        const newPath = newBasePath + relativePath;
        newPages[newPath] = updatedPages[oldPath];
        if (currentPage === oldPath) setCurrentPage(newPath);
      } else {
        newPages[oldPath] = updatedPages[oldPath];
      }
    });
  
    setPages(newPages);
  
    // Mettez à jour les autres états
    setCodeHistory((prev) => {
      const updatedHistory = { ...prev };
      Object.keys(updatedHistory).forEach((oldPath) => {
        if (oldPath === draggedId || oldPath.startsWith(`${draggedId}/`)) {
          const relativePath = oldPath.substring(draggedId.length);
          const newPath = newBasePath + relativePath;
          updatedHistory[newPath] = updatedHistory[oldPath];
          delete updatedHistory[oldPath];
        }
      });
      return updatedHistory;
    });
  
    setHistoryIndex((prev) => {
      const updatedIndex = { ...prev };
      Object.keys(updatedIndex).forEach((oldPath) => {
        if (oldPath === draggedId || oldPath.startsWith(`${draggedId}/`)) {
          const relativePath = oldPath.substring(draggedId.length);
          const newPath = newBasePath + relativePath;
          updatedIndex[newPath] = updatedIndex[oldPath];
          delete updatedIndex[oldPath];
        }
      });
      return updatedIndex;
    });
  
    setInitialPages((prev) => {
      const updatedInitial = { ...prev };
      Object.keys(updatedInitial).forEach((oldPath) => {
        if (oldPath === draggedId || oldPath.startsWith(`${draggedId}/`)) {
          const relativePath = oldPath.substring(draggedId.length);
          const newPath = newBasePath + relativePath;
          updatedInitial[newPath] = updatedInitial[oldPath];
          delete updatedInitial[oldPath];
        }
      });
      return updatedInitial;
    });
  
    // Synchronisez avec le backend
    debouncedUpdateHierarchy(newStructure);
    setDraggedItem(null);
  };

  const renderFolderStructure = (
    structure: FolderStructure,
    parentPath: string = '',
    depth: number = 0
  ) => {
    return Object.entries(structure).map(([name, item]) => {
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      const isExpanded = expandedFolders[fullPath] || false;

      return (
        <div key={fullPath} className="flex flex-col">
          <div
            className={`flex items-center py-1 px-2 rounded hover:bg-gray-800/50 transition-colors w-full ${
              currentPage === fullPath ? 'bg-purple-600/20' : ''
            }`}
            draggable
            onDragStart={(e) => handleDragStart(e, fullPath)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, fullPath)}
            onDragEnd={handleDragEnd}
          >
            <button
              className={`flex items-center space-x-2 text-gray-400 hover:text-purple-300 ${
                currentPage === fullPath ? 'text-purple-400' : ''
              }`}
              onClick={() => {
                if (item.type === 'file') {
                  setCurrentPage(fullPath);
                } else {
                  setExpandedFolders((prev) => ({
                    ...prev,
                    [fullPath]: !prev[fullPath],
                  }));
                }
              }}
              aria-label={item.type === 'file' ? `Open ${name}` : `Toggle ${name}`}
            >
              <span className="w-5 h-5 flex items-center justify-center">
                {item.type === 'folder' ? (isExpanded ? '▼' : '▶') : '📄'}
              </span>
              <span className="text-sm truncate">{name}</span>
            </button>
            <div className="ml-auto flex space-x-1">
              {item.type === 'folder' && (
                <button
                  className="p-1 text-gray-400 hover:text-green-400 transition"
                  onClick={() => handleAddPage(fullPath)}
                  aria-label={`Add page to ${name}`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
              )}
              <button
                className="p-1 text-gray-400 hover:text-purple-400 transition"
                onClick={() => handleRenamePage(fullPath)}
                aria-label={`Rename ${name}`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>
                <button
                  className="p-1 text-gray-400 hover:text-red-400 transition"
                  onClick={() => handleDeletePage(fullPath)}
                  aria-label={`Delete ${name}`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
            {item.type === 'folder' && isExpanded && item.children && (
              <div className="ml-4">
                {renderFolderStructure(item.children, fullPath, depth + 1)}
              </div>
            )}
          </div>
        );
      });
    };

  return (
    <div className="flex h-screen bg-black text-gray-100 font-sans relative">
      <style>
        {`
          .shadow-glow {
            box-shadow: 0 0 15px rgba(139, 92, 246, 0.7);
          }
          .pulse-button {
            animation: pulseButton 2s infinite ease-in-out;
          }
          .press-button {
            animation: pressButton 0.2s ease-in-out;
          }
          .dragging {
            opacity: 0.5;
            background-color: rgba(139, 92, 246, 0.2);
          }
          .drag-over {
            background-color: rgba(139, 92, 246, 0.3);
            border: 2px dashed rgba(139, 92, 246, 0.5);
          }
          @keyframes pulseButton {
            0% { transform: scale(1); opacity: 0.9; }
            50% { transform: scale(1.03); opacity: 1; }
            100% { transform: scale(1); opacity: 0.9; }
          }
          @keyframes pressButton {
            0% { transform: scale(1); }
            50% { transform: scale(0.95); }
            100% { transform: scale(1); }
          }
          body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: repeating-linear-gradient(
              0deg,
              transparent,
              transparent 10px,
              rgba(139, 92, 246, 0.1) 10px,
              rgba(139, 92, 246, 0.1) 11px
            ),
            repeating-linear-gradient(
              90deg,
              transparent,
              transparent 10px,
              rgba(139, 92, 246, 0.1) 10px,
              rgba(139, 92, 246, 0.1) 11px
            );
            animation: pulseGrid 20s linear infinite;
            z-index: -1;
          }
          @keyframes pulseGrid {
            0% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.02); }
            100% { opacity: 0.3; transform: scale(1); }
          }
        `}
      </style>
      <div className="w-48 bg-gray-900/80 backdrop-blur-lg border-r border-purple-600/50 flex flex-col">
        <div className="p-2 border-b border-purple-600/50 flex justify-center">
          <svg
            className="w-6 h-6 text-purple-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 7h18M3 12h18m-9 5h9"
            />
          </svg>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {renderFolderStructure(folderStructure)}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-gray-900/80 backdrop-blur-lg border-b border-purple-600/50 px-6 py-3 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <h1
                className="text-xl font-bold text-purple-300 tracking-tight"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
              >
               
              </h1>
              <div className="flex space-x-2">
                <button
                  className="p-2 rounded-full bg-gray-800/50 text-gray-300 hover:bg-purple-600/50 hover:text-white hover:shadow-glow transition-all duration-300 disabled:opacity-50 pulse-button"
                  onClick={(e) => {
                    handleBack();
                    e.currentTarget.classList.add('press-button');
                  }}
                  disabled={isLoading || (historyIndex[currentPage] || 0) <= 0}
                  title="Undo"
                  aria-label="Undo last change"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                    />
                  </svg>
                </button>
                <button
                  className="p-2 rounded-full bg-gray-800/50 text-gray-300 hover:bg-purple-600/50 hover:text-white hover:shadow-glow transition-all duration-300 disabled:opacity-50 pulse-button"
                  onClick={(e) => {
                    handleForward();
                    e.currentTarget.classList.add('press-button');
                  }}
                  disabled={
                    isLoading ||
                    (historyIndex[currentPage] || 0) >=
                      (codeHistory[currentPage]?.length || 1) - 1
                  }
                  title="Redo"
                  aria-label="Redo next change"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"
                    />
                  </svg>
                </button>
                <button
                  className="p-2 rounded-full bg-gray-800/50 text-gray-300 hover:bg-purple-600/50 hover:text-white hover:shadow-glow transition-all duration-300 disabled:opacity-50 pulse-button"
                  onClick={(e) => {
                    handleRefresh();
                    e.currentTarget.classList.add('press-button');
                  }}
                  disabled={isLoading || !initialPages[currentPage]}
                  title="Refresh"
                  aria-label="Refresh page"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                className="px-5 py-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 hover:shadow-glow hover:scale-105 transition-all duration-300 disabled:opacity-50 flex items-center space-x-2 pulse-button"
                onClick={(e) => {
                  handleAddPage();
                  e.currentTarget.classList.add('press-button');
                }}
                disabled={isLoading}
                aria-label="Create new page"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>New Page</span>
              </button>
              <button
  className="px-5 py-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 hover:shadow-glow hover:scale-105 transition-all duration-300 disabled:opacity-50 flex items-center space-x-2 pulse-button"
  onClick={(e) => {
    handleAddFolder();
    e.currentTarget.classList.add('press-button');
  }}
  disabled={isLoading}
  aria-label="Create new folder"
>
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
    />
  </svg>
  <span>New Folder</span>
</button>
              <button
                className="px-5 py-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 hover:shadow-glow hover:scale-105 transition-all duration-300 flex items-center space-x-2 pulse-button"
                onClick={(e) => {
                  handleExport(e);
                  e.currentTarget.classList.add('press-button');
                }}
                aria-label="Export pages"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span>Export</span>
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-1/3 flex flex-col p-4 gap-4">
            <div className="flex-1 flex flex-col bg-gray-900/80 backdrop-blur-lg rounded-xl shadow-xl border border-purple-600/50 overflow-hidden">
              <div className="p-4 border-b border-purple-600/50">
                <h2
                  className="text-lg font-medium text-purple-300 fade-in"
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  Code Editor
                </h2>
              </div>
              <div className="flex-1 overflow-hidden">
                <CodeEditor
                  code={pages[currentPage]?.code || ''}
                  onChange={(value) => {
                    setPages((prev) => ({
                      ...prev,
                      [currentPage]: { ...prev[currentPage], code: value || '' },
                    }));
                    setCodeHistory((prev) => {
                      const currentHistory = prev[currentPage] || [];
                      const currentIndex = historyIndex[currentPage] || 0;
                      const newHistory = currentHistory.slice(0, currentIndex + 1);
                      newHistory.push({
                        code: value || '',
                        theme: pages[currentPage].theme,
                      });
                      return {
                        ...prev,
                        [currentPage]: newHistory,
                      };
                    });
                    setHistoryIndex((prev) => ({
                      ...prev,
                      [currentPage]: (historyIndex[currentPage] || 0) + 1,
                    }));
                  }}
                />
              </div>
            </div>

            <div className="bg-gray-900/80 backdrop-blur-lg rounded-xl shadow-xl border border-purple-600/50 p-4">
              <div className="flex items-center space-x-2">
                <PromptInput
                  onSubmit={handlePromptSubmit}
                  isLoading={isLoading}
                  placeholder="Describe your website modifications..."
                  submitLabel="Submit"
                />
                <button
                  className="px-3 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 hover:shadow-glow transition-all duration-300 disabled:opacity-50 text-sm flex items-center space-x-1"
                  onClick={handleAddImage}
                  disabled={isLoading}
                  aria-label="Add image"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span>Add Image</span>
                </button>
                <button
                  className="px-3 py-2 bg-green-600 text-white rounded-full hover:bg-green-700 hover:shadow-glow transition-all duration-300 disabled:opacity-50 text-sm flex items-center space-x-1"
                  onClick={() => {
                    const address = prompt('Enter the address for the map:');
                    if (address) {
                      handleAddMap(address);
                    }
                  }}
                  disabled={isLoading}
                  aria-label="Add map"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  <span>Add Map</span>
                </button>
              </div>
              {promptHistory.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-400 mb-2 fade-in">
                    Prompt History
                  </h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {promptHistory.map((prompt, index) => (
                      <div
                        key={index}
                        className="bg-gray-800/50 p-3 rounded-lg text-sm text-gray-300 hover:bg-gray-700/50 transition fade-in"
                      >
                        {prompt}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 p-4">
            <div className="h-full flex flex-col bg-gray-900/80 backdrop-blur-lg rounded-xl shadow-xl border border-purple-600/50 overflow-hidden">
              <div className="p-4 border-b border-purple-600/50">
                <h2
                  className="text-lg font-medium text-purple-300 fade-in"
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  Live Preview
                </h2>
              </div>
              <div className="flex-1 overflow-hidden">
                <LivePreview
                  pages={Object.fromEntries(
                    Object.entries(pages)
                      .filter(([key]) => key.endsWith('.html'))
                      .map(([k, v]) => [k, v.code])
                  )}
                  currentPage={currentPage}
                  onPageChange={(page) => setCurrentPage(page)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebsiteGenerator;