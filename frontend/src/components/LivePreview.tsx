'use client';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { debounce } from 'lodash';

interface LivePreviewProps {
  pages: { [key: string]: string };
  currentPage: string;
  onFileUpload?: (file: File, content: string) => void;
  onPageChange?: (page: string) => void;
}

const LivePreview: React.FC<LivePreviewProps> = ({ pages, currentPage, onPageChange, onFileUpload }) => {
  const [localPage, setLocalPage] = useState<string>(currentPage);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastValidHTML, setLastValidHTML] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Clean HTML code
  const cleanCode = useCallback((htmlCode: string, pageName: string): string => {
    try {
      let cleaned = htmlCode
        .replace(/^[\s\S]*?(<!DOCTYPE html[\s\S]*?<\/html>)/i, '$1')
        .replace(/```html\n|```/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();
  
      if (!cleaned) throw new Error('HTML content is empty after cleaning');
  
      if (!cleaned.startsWith('<!DOCTYPE html>')) cleaned = '<!DOCTYPE html>\n' + cleaned;
      if (!cleaned.includes('<html')) cleaned = '<!DOCTYPE html>\n<html lang="en">\n' + cleaned + '\n</html>';
      if (!cleaned.includes('<head>')) {
        cleaned = cleaned.replace(
          '<html',
          '<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>\n'
        );
      }
      if (!cleaned.includes('<body>')) {
        cleaned = cleaned.replace('</head>', '</head>\n<body>\n') + '\n</body>';
      }
  
      if (!cleaned.endsWith('</html>')) cleaned = cleaned + '\n</html>';
  
      return cleaned;
    } catch (err) {
      console.error('Error in cleanCode:', err);
      return lastValidHTML || `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body>
            <h1>Erreur : Contenu HTML invalide</h1>
          </body>
        </html>
      `;
    }
  }, [currentPage,lastValidHTML]);

  // Inject drag-and-drop, text editing, and control frame script
  const injectDragDropScript = () => `
    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const editableElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, div, section, article, aside, figure, img, button');
        let elementCounter = editableElements.length;

        editableElements.forEach((el, index) => {
          const isGoogleMapSection = el.tagName === 'SECTION' && el.querySelector('#map');
          if ((el.textContent && el.textContent.trim()) || el.tagName === 'IMG' || el.tagName === 'BUTTON' || isGoogleMapSection) {
            el.setAttribute('draggable', 'true');
            el.setAttribute('data-drag-id', 'drag-' + index);
            el.style.position = 'relative';
            el.style.cursor = 'move';
            el.style.display = isGoogleMapSection ? 'block' : (el.tagName === 'IMG' ? 'inline-block' : el.style.display || 'block');
            if (isGoogleMapSection) {
              const mapDiv = el.querySelector('#map');
              if (mapDiv) {
                mapDiv.style.width = mapDiv.style.width || '100%';
                mapDiv.style.height = mapDiv.style.height || '400px';
              }
            }

            // Add click handler to show selection frame and toolbar
            el.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();

              // Remove existing frame and toolbar
              const existingFrame = document.querySelector('.selection-frame');
              if (existingFrame) existingFrame.remove();
              const existingToolbar = document.querySelector('.control-toolbar');
              if (existingToolbar) existingToolbar.remove();

              // Create selection frame
              const rect = el.getBoundingClientRect();
              const frame = document.createElement('div');
              frame.className = 'selection-frame';
              frame.style.position = 'absolute';
              frame.style.top = (rect.top - 2 + window.scrollY) + 'px';
              frame.style.left = (rect.left - 2 + window.scrollX) + 'px';
              frame.style.width = (rect.width + 4) + 'px';
              frame.style.height = (rect.height + 4) + 'px';
              frame.style.border = '2px solid #007bff';
              frame.style.zIndex = '999';
              frame.setAttribute('data-target-id', 'drag-' + index);
              document.body.appendChild(frame);

              // Create toolbar
              const toolbar = document.createElement('div');
              toolbar.className = 'control-toolbar';
              toolbar.style.position = 'absolute';
              toolbar.style.top = (rect.top - 40 + window.scrollY) + 'px';
              toolbar.style.left = (rect.left + rect.width / 2 - 100 + window.scrollX) + 'px';
              toolbar.style.background = '#fff';
              toolbar.style.border = '1px solid #ddd';
              toolbar.style.borderRadius = '8px';
              toolbar.style.padding = '4px';
              toolbar.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
              toolbar.style.zIndex = '1000';
              toolbar.style.display = 'flex';
              toolbar.style.gap = '4px';

              const icons = [
                { title: 'Edit', icon: '✏️' },
                { title: 'Lock', icon: '🔒' },
                { title: 'Duplicate', icon: '📋' },
                { title: 'Delete', icon: '🗑️' },
                { title: 'More', icon: '⋯' }
              ].map(item => {
                const btn = document.createElement('button');
                btn.innerHTML = item.icon;
                btn.title = item.title;
                btn.style.border = 'none';
                btn.style.background = 'none';
                btn.style.cursor = 'pointer';
                btn.style.fontSize = '16px';
                btn.style.padding = '4px';
                btn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  if (item.title === 'Delete') {
                    el.remove();
                    frame.remove();
                    toolbar.remove();
                  } else if (item.title === 'Duplicate') {
                    const clone = el.cloneNode(true);
                    elementCounter++;
                    clone.setAttribute('data-drag-id', 'drag-' + elementCounter);
                    el.parentNode.insertBefore(clone, el.nextSibling);
                    frame.remove();
                    toolbar.remove();
                  }
                  const newHTML = document.documentElement.outerHTML;
                  window.parent.postMessage({ type: 'update-html', html: newHTML }, '*');
                });
                return btn;
              });

              icons.forEach(btn => toolbar.appendChild(btn));
              document.body.appendChild(toolbar);

              // Hide frame and toolbar when clicking outside
              document.addEventListener('click', function hideFrame(e) {
                if (!frame.contains(e.target) && !el.contains(e.target) && !toolbar.contains(e.target)) {
                  frame.remove();
                  toolbar.remove();
                  document.removeEventListener('click', hideFrame);
                }
              }, { once: true });
            });
          }
        });

        let draggedElement = null;
        let dropTarget = null;
        let isDragging = false;
        let isResizing = false;
        let resizeTarget = null;
        let startX, startY, startWidth, startHeight;
        let resizeEdge = '';

        // Drag-and-drop functionality
        const handleDragStart = (e) => {
          const target = e.target.closest('[draggable="true"]');
          if (target && !isResizing && ((target.textContent && target.textContent.trim()) || target.tagName === 'IMG' || target.tagName === 'BUTTON' || (target.tagName === 'SECTION' && target.querySelector('#map')))) {
            draggedElement = target;
            isDragging = true;
            target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            const existingFrame = document.querySelector('.selection-frame');
            if (existingFrame) existingFrame.remove();
            const existingToolbar = document.querySelector('.control-toolbar');
            if (existingToolbar) existingToolbar.remove();
          }
        };

        const handleDragOver = (e) => {
          e.preventDefault();
          const target = e.target.closest('[draggable="true"]');
          if (draggedElement && target !== draggedElement && ((target.textContent && target.textContent.trim()) || target.tagName === 'IMG' || target.tagName === 'BUTTON' || (target.tagName === 'SECTION' && target.querySelector('#map')))) {
            dropTarget = target;
            target.classList.add('drag-over');
          }
        };

        const handleDragLeave = (e) => {
          const target = e.target.closest('[draggable="true"]');
          if (target) {
            target.classList.remove('drag-over');
            dropTarget = null;
          }
        };

        const handleDrop = (e) => {
          e.preventDefault();
          const target = dropTarget;
          if (draggedElement && target && draggedElement !== target && ((draggedElement.textContent && draggedElement.textContent.trim()) || draggedElement.tagName === 'IMG' || draggedElement.tagName === 'BUTTON' || (draggedElement.tagName === 'SECTION' && draggedElement.querySelector('#map')))) {
            const parent = target.parentElement;
            if (parent) {
              const isImageDrag = draggedElement.tagName === 'IMG';
              const isImageTarget = target.tagName === 'IMG';
              const isButtonDrag = draggedElement.tagName === 'BUTTON';
              const isButtonTarget = target.tagName === 'BUTTON';
              const isGoogleMapSectionDrag = draggedElement.tagName === 'SECTION' && draggedElement.querySelector('#map');
              const isGoogleMapSectionTarget = target.tagName === 'SECTION' && target.querySelector('#map');

              if ((isImageDrag && isImageTarget) || (isButtonDrag && isButtonTarget) || (isGoogleMapSectionDrag && isGoogleMapSectionTarget)) {
                const tempHTML = draggedElement.innerHTML;
                const tempWidth = draggedElement.style.width;
                const tempHeight = draggedElement.style.height;
                draggedElement.innerHTML = target.innerHTML;
                draggedElement.style.width = target.style.width;
                draggedElement.style.height = target.style.height;
                target.innerHTML = tempHTML;
                target.style.width = tempWidth;
                target.style.height = tempHeight;

                if (isGoogleMapSectionDrag || isGoogleMapSectionTarget) {
                  [draggedElement, target].forEach(section => {
                    const mapDiv = section.querySelector('#map');
                    if (mapDiv) {
                      const script = section.querySelector('script:not([src])');
                      if (script) eval(script.textContent);
                    }
                  });
                }
              } else {
                parent.insertBefore(draggedElement, target);
              }
              draggedElement.classList.remove('dragging');
              target.classList.remove('drag-over');
              draggedElement = null;
              dropTarget = null;

              const newHTML = document.documentElement.outerHTML;
              window.parent.postMessage({ type: 'update-html', html: newHTML }, '*');
            }
          }
        };

        const handleDragEnd = () => {
          if (draggedElement) {
            draggedElement.classList.remove('dragging');
            draggedElement = null;
          }
          if (dropTarget) {
            dropTarget.classList.remove('drag-over');
            dropTarget = null;
          }
          isDragging = false;
        };

        // Attach drag-and-drop event listeners
        document.addEventListener('dragstart', handleDragStart);
        document.addEventListener('dragover', handleDragOver);
        document.addEventListener('dragleave', handleDragLeave);
        document.addEventListener('drop', handleDrop);
        document.addEventListener('dragend', handleDragEnd);

        // Text editing for all text-containing elements
        const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, button');
        textElements.forEach(el => {
          if (el.textContent && el.textContent.trim()) {
            el.style.overflowWrap = el.style.overflowWrap || 'break-word';
            el.style.wordBreak = el.style.wordBreak || 'break-word';
            el.style.whiteSpace = el.style.whiteSpace || 'normal';

            el.addEventListener('click', (e) => {
              if (el.classList.contains('editing')) return;
              el.classList.add('editing');

              const computedStyle = window.getComputedStyle(el);
              const originalText = el.textContent;

              const textarea = document.createElement('textarea');
              textarea.value = originalText;

              textarea.style.width = computedStyle.width;
              textarea.style.maxWidth = computedStyle.maxWidth === 'none' ? computedStyle.width : computedStyle.maxWidth;
              textarea.style.height = 'auto';
              textarea.style.minHeight = computedStyle.height;
              textarea.style.maxHeight = computedStyle.maxHeight === 'none' ? 'none' : computedStyle.maxHeight;
              textarea.style.padding = computedStyle.padding;
              textarea.style.margin = computedStyle.margin;
              textarea.style.border = '1px solid #ccc';
              textarea.style.borderRadius = computedStyle.borderRadius;
              textarea.style.fontFamily = computedStyle.fontFamily;
              textarea.style.fontSize = computedStyle.fontSize;
              textarea.style.fontWeight = computedStyle.fontWeight;
              textarea.style.color = computedStyle.color;
              textarea.style.backgroundColor = computedStyle.backgroundColor;
              textarea.style.lineHeight = computedStyle.lineHeight;
              textarea.style.textAlign = computedStyle.textAlign;
              textarea.style.boxSizing = 'border-box';
              textarea.style.resize = 'vertical';
              textarea.style.overflowWrap = 'break-word';
              textarea.style.wordBreak = 'break-word';
              textarea.style.whiteSpace = 'normal';
              textarea.style.overflow = computedStyle.overflow === 'visible' ? 'auto' : computedStyle.overflow;

              el.textContent = '';
              el.appendChild(textarea);
              textarea.focus();

              textarea.style.height = 'auto';
              textarea.style.height = \`\${textarea.scrollHeight}px\`;

              textarea.addEventListener('input', () => {
                textarea.style.height = 'auto';
                textarea.style.height = \`\${textarea.scrollHeight}px\`;
              });

              textarea.addEventListener('blur', () => {
                const newText = textarea.value || originalText;
                while (el.firstChild) {
                  el.removeChild(el.firstChild);
                }
                el.textContent = newText;
                el.classList.remove('editing');

                el.style.overflowWrap = 'break-word';
                el.style.wordBreak = 'break-word';
                el.style.whiteSpace = 'normal';

                const newHTML = document.documentElement.outerHTML;
                window.parent.postMessage({ type: 'update-html', html: newHTML }, '*');
              });

              textarea.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  textarea.blur();
                }
              });
            });
          }
        });

        // Helper function to determine if the mouse is near an edge
        const isNearEdge = (el, clientX, clientY) => {
          const rect = el.getBoundingClientRect();
          const edgeThreshold = 10;
          const nearRight = Math.abs(clientX - rect.right) < edgeThreshold;
          const nearBottom = Math.abs(clientY - rect.bottom) < edgeThreshold;
          const nearLeft = Math.abs(clientX - rect.left) < edgeThreshold;
          const nearTop = Math.abs(clientY - rect.top) < edgeThreshold;

          if (nearRight && nearBottom) return 'bottom-right';
          if (nearLeft && nearBottom) return 'bottom-left';
          if (nearRight && nearTop) return 'top-right';
          if (nearLeft && nearTop) return 'top-left';
          if (nearRight) return 'right';
          if (nearLeft) return 'left';
          if (nearBottom) return 'bottom';
          if (nearTop) return 'top';
          return '';
        };

        // Edge-based resizing on the selection frame
        document.addEventListener('mousemove', (e) => {
          if (isResizing) return;

          const frame = document.querySelector('.selection-frame');
          if (frame) {
            const edge = isNearEdge(frame, e.clientX, e.clientY);
            if (edge === 'bottom-right' || edge === 'top-left') {
              frame.style.cursor = 'se-resize';
            } else if (edge === 'bottom-left' || edge === 'top-right') {
              frame.style.cursor = 'sw-resize';
            } else if (edge === 'left' || edge === 'right') {
              frame.style.cursor = 'ew-resize';
            } else if (edge === 'top' || edge === 'bottom') {
              frame.style.cursor = 'ns-resize';
            } else {
              frame.style.cursor = 'default';
            }
          }
        });

        document.addEventListener('mousedown', (e) => {
          const frame = document.querySelector('.selection-frame');
          const target = document.querySelector('[data-drag-id="' + (frame?.getAttribute('data-target-id') || '') + '"]');
          if (frame && target) {
            const edge = isNearEdge(frame, e.clientX, e.clientY);
            if (edge) {
              isResizing = true;
              resizeTarget = target;
              resizeEdge = edge;
              startX = e.clientX;
              startY = e.clientY;
              startWidth = parseInt(getComputedStyle(target).width) || target.offsetWidth;
              startHeight = parseInt(getComputedStyle(target).height) || target.offsetHeight;
              e.preventDefault();
            }
          }
        });

        document.addEventListener('mousemove', (e) => {
          if (!isResizing || !resizeTarget) return;

          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          let newWidth = startWidth;
          let newHeight = startHeight;

          if (resizeEdge.includes('right')) {
            newWidth = Math.max(50, startWidth + dx);
          } else if (resizeEdge.includes('left')) {
            newWidth = Math.max(50, startWidth - dx);
            resizeTarget.style.left = (parseInt(getComputedStyle(resizeTarget).left) || 0) + (startWidth - newWidth) + 'px';
          }
          if (resizeEdge.includes('bottom')) {
            newHeight = Math.max(50, startHeight + dy);
          } else if (resizeEdge.includes('top')) {
            newHeight = Math.max(50, startHeight - dy);
            resizeTarget.style.top = (parseInt(getComputedStyle(resizeTarget).top) || 0) + (startHeight - newHeight) + 'px';
          }

          resizeTarget.style.width = \`\${newWidth}px\`;
          resizeTarget.style.height = \`\${newHeight}px\`;

          const mapDiv = resizeTarget.querySelector('#map');
          if (mapDiv) {
            mapDiv.style.width = \`\${newWidth}px\`;
            mapDiv.style.height = \`\${newHeight - 50}px\`;
            if (typeof google !== 'undefined' && google.maps) {
              google.maps.event.trigger(mapDiv.__gmap__, 'resize');
            }
          }

          // Update the frame size
          const frame = document.querySelector('.selection-frame');
          if (frame) {
            frame.style.width = (newWidth + 4) + 'px';
            frame.style.height = (newHeight + 4) + 'px';
            frame.style.left = (resizeTarget.getBoundingClientRect().left - 2 + window.scrollX) + 'px';
            frame.style.top = (resizeTarget.getBoundingClientRect().top - 2 + window.scrollY) + 'px';
          }
        });

        document.addEventListener('mouseup', () => {
          if (isResizing) {
            isResizing = false;
            const newHTML = document.documentElement.outerHTML;
            window.parent.postMessage({ type: 'update-html', html: newHTML }, '*');
            resizeTarget.style.cursor = 'move';
            resizeTarget = null;
            resizeEdge = '';
          }
        });
      });
    </script>
    <style>
      .dragging {
        opacity: 0.5;
        transform: scale(1.2);
        transition: opacity 0.3s, transform 0.2s ease-in-out;
        border: 2px dashed #007bff;
      }
      .drag-over {
        background: #a5d6a7;
        border: 2px dashed #4caf50;
      }
      [draggable="true"] {
        padding: 0.5rem;
        margin: 0.5rem;
        cursor: grab;
      }
      [draggable="true"].dragging {
        cursor: grabbing;
      }
      .editing {
        border: 1px dashed #007bff;
        padding: 5px;
      }
      img, div, section, article, aside, figure, button {
        min-width: 50px;
        min-height: 50px;
      }
      section:has(#map) {
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 10px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      }
      .control-toolbar button:hover {
        background: #f0f0f0;
        border-radius: 4px;
      }
      .selection-frame {
        pointer-events: auto;
        box-sizing: border-box;
      }
    </style>
  `;

  // Process HTML with navigation and drag-and-drop scripts
  const processHTML = useCallback((html: string, pageList: string[]): string => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

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
        doc.body.appendChild(script);
      }

      if (!doc.querySelector('script[data-drag-drop-handler]')) {
        const dragDropScript = doc.createElement('script');
        dragDropScript.setAttribute('data-drag-drop-handler', 'true');
        dragDropScript.textContent = injectDragDropScript();
        doc.body.appendChild(dragDropScript);
      }

      const nav = doc.querySelector('nav');
      if (nav && pageList.length > 0) {
        const theme = nav.getAttribute('data-theme') || 'digital';
        nav.outerHTML = getNavBar(pageList, currentPage, theme);
      }

      return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    } catch (err) {
      console.error('Error processing HTML:', err);
      throw new Error('Invalid HTML content');
    }
  }, [currentPage]);

  // Navigation bar generator
  function getNavBar(pages: string[], currentPage: string, theme: string): string {
    const colors = {
      navBg: 'rgba(42, 42, 42, 0.8)',
      navLink: '#e0e0e0',
      navActive: '#bb86fc',
    };
    return `
      <nav style="position: sticky; top: 0; background: ${colors.navBg}; padding: 1rem 2rem; text-align: center; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1); z-index: 1000;">
        ${pages.map(page => {
          const pageName = page.replace('.html', '');
          const isActive = page === currentPage;
          const activeStyle = isActive ? `color: ${colors.navActive}; border-bottom: 2px solid ${colors.navActive};` : '';
          return `<a href="${page}" style="color: ${colors.navLink}; text-decoration: none; margin: 0 1.5rem; font-weight: 600; ${activeStyle}">${pageName}</a>`;
        }).join('')}
      </nav>
    `;
  }

  // Handle drag-and-drop events for file uploads
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target && typeof event.target.result === 'string') {
          if (onFileUpload) onFileUpload(file, event.target.result);
        }
      };
      reader.readAsText(file);
    }
  }, [onFileUpload]);

  // Update iframe content with debouncing
  const updateIframe = useMemo(
    () =>
      debounce(() => {
        const iframe = iframeRef.current;
        if (!iframe || !pages[currentPage]) {
          setError('Page not found or iframe unavailable');
          setIsLoading(false);
          if (iframe && lastValidHTML) iframe.srcdoc = lastValidHTML;
          return;
        }

        setIsLoading(true);
        setError(null);

        try {
          const cleanedHTML = cleanCode(pages[currentPage], currentPage);
          const pageList = Object.keys(pages);
          const processedHTML = processHTML(cleanedHTML + injectDragDropScript(), pageList);
          iframe.srcdoc = processedHTML;
          setLastValidHTML(processedHTML);
        } catch (err) {
          setError('Failed to load page content: ' + (err instanceof Error ? err.message : String(err)));
          setIsLoading(false);
          if (iframe && lastValidHTML) iframe.srcdoc = lastValidHTML;
        }
      }, 300),
    [currentPage, pages, processHTML, cleanCode, lastValidHTML]
  );

  // Handle iframe updates and messages
  useEffect(() => {
    updateIframe();

    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => setIsLoading(false);
    iframe.addEventListener('load', handleLoad);

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== 'http://localhost:3000') return; // Security check
      if (event.data?.type === 'navigation' && typeof event.data.href === 'string') {
        if (pages[event.data.href]) {
          setLocalPage(event.data.href);
          onPageChange?.(event.data.href);
        }
        else {
          setError(`Page "${event.data.href}" not found`);
          const fallbackPage = Object.keys(pages).filter(page => page.endsWith('.html'))[0] || '';
          setLocalPage(fallbackPage);
          onPageChange?.(fallbackPage);
        }
      } else if (event.data?.type === 'file-drop') {
        if (onFileUpload) {
          const fileContent = event.data.fileContent;
          const fileName = event.data.fileName;
          if (typeof fileContent === 'string' && typeof fileName === 'string') {
            const file = new File([fileContent], fileName, { type: 'text/html' });
            onFileUpload(file, fileContent);
          }
        }
      } else if (event.data?.type === 'update-html') {
        const newHTML = event.data.html;
        try {
          const response = await fetch('http://localhost:5000/api/save-page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pagePath: currentPage, code: newHTML }),
          });
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const result = await response.json();
          pages[currentPage] = newHTML; // Update local state
          updateIframe(); // Refresh iframe
        } catch (err) {
          setError(`Failed to save updated HTML: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      iframe.removeEventListener('load', handleLoad);
      updateIframe.cancel();
      window.removeEventListener('message', handleMessage);
    };
  }, [currentPage, pages, updateIframe, onFileUpload]);

  // Validate initial page
  useEffect(() => {
    if (!pages[currentPage]) {
      setError(`Page "${currentPage}" not found`);
      const firstPage = Object.keys(pages).filter(page => page.endsWith('.html'))[0] || '';
      if (!localPage && firstPage) {
        setLocalPage(firstPage);
        onPageChange?.(firstPage);
      }
    } else if (!localPage) {
      setLocalPage(currentPage);
    }
  }, [currentPage, pages]);

  return (
    <div
      ref={dropZoneRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative h-full w-full rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden transition-all duration-300 ${isDragOver ? 'border-purple-500 border-4' : ''}`}
    >
      {isDragOver && (
        <div className="absolute inset-0 bg-purple-500 bg-opacity-50 z-50 flex items-center justify-center">
          <div className="text-white text-2xl font-bold">Drop your file here</div>
        </div>
      )}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 transition-opacity duration-200">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-purple-600"></div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-10 p-4">
          <p className="text-red-600 font-medium text-sm">{error}</p>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="Live Preview"
        className="w-full h-full bg-white"
        sandbox="allow-scripts allow-same-origin allow-popups"
        onError={() => setError('Failed to load iframe content')}
      />
    </div>
  );
};

export default LivePreview;