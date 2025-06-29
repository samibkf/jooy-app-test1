import React, { useState, useEffect, useRef, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "../styles/Worksheet.css";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Sparkles } from "lucide-react";
import { getTextDirection } from "@/lib/textDirection";
import type { WorksheetMetadata, RegionData } from "@/types/worksheet";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface StoredRegionData {
  currentStepIndex: number;
}

interface WorksheetViewerProps {
  worksheetId: string;
  pageIndex: number;
  worksheetMeta: WorksheetMetadata;
  pdfUrl: string;
  onTextModeChange?: (isTextMode: boolean) => void;
  initialActiveRegion?: RegionData | null;
  initialCurrentStepIndex?: number;
  onRegionStateChange?: (region: RegionData | null, stepIndex: number) => void;
  allRegionsState?: Record<string, StoredRegionData>;
}

const WorksheetViewer: React.FC<WorksheetViewerProps> = ({ 
  worksheetId, 
  pageIndex, 
  worksheetMeta,
  pdfUrl,
  onTextModeChange,
  initialActiveRegion,
  initialCurrentStepIndex = 0,
  onRegionStateChange,
  allRegionsState = {}
}) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  
  const [pdfDimensions, setPdfDimensions] = useState({ width: 0, height: 0 });
  const [scaleFactor, setScaleFactor] = useState(1);
  const [pdfPosition, setPdfPosition] = useState({ top: 0, left: 0 });
  
  const [activeRegion, setActiveRegion] = useState<RegionData | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  
  const [isTextMode, setIsTextMode] = useState<boolean>(false);
  
  const [displayedMessages, setDisplayedMessages] = useState<string[]>([]);
  
  const [isCurrentPageDrmProtected, setIsCurrentPageDrmProtected] = useState<boolean>(false);
  
  const [isAudioPlaying, setIsAudioPlaying] = useState<boolean>(false);
  const [audioAvailable, setAudioAvailable] = useState<boolean>(true);
  const [audioCheckPerformed, setAudioCheckPerformed] = useState<boolean>(false);
  
  // State to track if initial state has been restored for the current worksheet/page
  const [hasRestoredInitialState, setHasRestoredInitialState] = useState<boolean>(false);
  
  // Refs to track previous values for change detection
  const prevWorksheetIdRef = useRef<string>(worksheetId);
  const prevPageIndexRef = useRef<number>(pageIndex);
  
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const textDisplayRef = useRef<HTMLDivElement>(null);

  // Filter regions for current page and ensure description is properly split into paragraphs
  const regions = useMemo(() => {
    if (!worksheetMeta?.regions) return [];
    return worksheetMeta.regions
      .filter((region: RegionData) => region.page === pageIndex)
      .map((region: RegionData) => {
        let processedDescription: string[] = [];
        
        if (Array.isArray(region.description)) {
          // If it's already an array, process each item to split by newlines
          processedDescription = region.description.flatMap(item => 
            typeof item === 'string' 
              ? item.split('\n').filter(paragraph => paragraph.trim() !== '')
              : []
          );
        } else if (typeof region.description === 'string') {
          // If it's a string, split by newlines
          processedDescription = region.description
            .split('\n')
            .filter(paragraph => paragraph.trim() !== '');
        }
        
        return {
          ...region,
          description: processedDescription
        };
      });
  }, [worksheetMeta, pageIndex]);

  // Check if current page is DRM protected
  useEffect(() => {
    if (worksheetMeta) {
      const isDrmProtected = worksheetMeta.drmProtected || 
        (Array.isArray(worksheetMeta.drmProtectedPages) && worksheetMeta.drmProtectedPages.includes(pageIndex));
      setIsCurrentPageDrmProtected(isDrmProtected);
    }
  }, [worksheetMeta, pageIndex]);

  // Reset component state ONLY when worksheet or page genuinely changes
  useEffect(() => {
    const worksheetChanged = prevWorksheetIdRef.current !== worksheetId;
    const pageChanged = prevPageIndexRef.current !== pageIndex;
    
    if (worksheetChanged || pageChanged) {
      // Reset all state to defaults
      setActiveRegion(null);
      setCurrentStepIndex(0);
      setDisplayedMessages([]);
      setIsTextMode(false);
      setIsAudioPlaying(false);
      setAudioCheckPerformed(false);
      setHasRestoredInitialState(false);
      
      // Notify parent about text mode change
      if (onTextModeChange) {
        onTextModeChange(false);
      }
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
      
      // Update refs for next comparison
      prevWorksheetIdRef.current = worksheetId;
      prevPageIndexRef.current = pageIndex;
    }
  }, [worksheetId, pageIndex, onTextModeChange]);

  // Apply initial state restoration (only once when initialActiveRegion is provided and not yet restored)
  useEffect(() => {
    if (initialActiveRegion && regions.length > 0 && !hasRestoredInitialState) {
      // Find the matching region in the current regions
      const matchingRegion = regions.find(region => region.id === initialActiveRegion.id);
      if (matchingRegion) {
        setActiveRegion(matchingRegion);
        setCurrentStepIndex(initialCurrentStepIndex);
        setIsTextMode(true);
        
        // Restore displayed messages up to the current step
        if (matchingRegion.description && matchingRegion.description.length > 0) {
          const messagesToDisplay = matchingRegion.description.slice(0, initialCurrentStepIndex + 1);
          setDisplayedMessages(messagesToDisplay);
          
          // Notify parent about text mode change
          if (onTextModeChange) {
            onTextModeChange(true);
          }
          
          // Start video if available
          if (videoRef.current && audioAvailable) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(err => {
              // Suppress expected errors when video is removed from DOM
              if (err.name !== 'AbortError' && !err.message.includes('media was removed from the document')) {
                // Suppress non-debug logs
              }
            });
          }
          
          // Play audio for current step if available
          if (audioAvailable) {
            setTimeout(() => {
              playAudioSegment(matchingRegion.name, initialCurrentStepIndex);
            }, 500);
          }
        }
        
        // Mark initial state as restored
        setHasRestoredInitialState(true);
      }
    }
  }, [initialActiveRegion, initialCurrentStepIndex, regions, hasRestoredInitialState, onTextModeChange, audioAvailable]);

  // Initial audio availability check - performed once when worksheet/page loads
  useEffect(() => {
    if (!audioCheckPerformed && regions.length > 0) {
      const firstRegion = regions[0];
      if (!firstRegion || !firstRegion.name) {
        setAudioAvailable(false);
        setAudioCheckPerformed(true);
        return;
      }
      
      const audioPath = `/audio/${worksheetId}/${firstRegion.name}_1.mp3`;
      
      // Create a temporary audio object for testing
      const testAudio = new Audio();
      let checkCompleted = false;
      
      const completeCheck = (available: boolean) => {
        if (checkCompleted) return;
        checkCompleted = true;
        
        setAudioAvailable(available);
        setAudioCheckPerformed(true);
        
        // Clean up event listeners
        testAudio.removeEventListener('canplaythrough', handleCanPlay);
        testAudio.removeEventListener('error', handleError);
      };
      
      const handleCanPlay = () => {
        completeCheck(true);
      };
      
      const handleError = () => {
        completeCheck(false);
      };
      
      // Set up event listeners
      testAudio.addEventListener('canplaythrough', handleCanPlay);
      testAudio.addEventListener('error', handleError);
      
      // Set timeout to handle cases where neither event fires
      const timeout = setTimeout(() => {
        completeCheck(false);
      }, 3000); // 3 second timeout
      
      // Start the test
      testAudio.src = audioPath;
      testAudio.load();
      
      // Cleanup function
      return () => {
        clearTimeout(timeout);
        testAudio.removeEventListener('canplaythrough', handleCanPlay);
        testAudio.removeEventListener('error', handleError);
        if (!checkCompleted) {
          testAudio.src = '';
        }
      };
    }
  }, [worksheetId, pageIndex, regions, audioCheckPerformed]);

  // Notify parent when region state changes
  useEffect(() => {
    if (onRegionStateChange) {
      onRegionStateChange(activeRegion, currentStepIndex);
    }
  }, [activeRegion, currentStepIndex, onRegionStateChange]);

  const handleMessageClick = (index: number) => {
    if (!activeRegion || !audioAvailable) return;
    
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    playAudioSegment(activeRegion.name, index);
    
    const messageElement = document.querySelector(`[data-message-index="${index}"]`);
    if (messageElement) {
      messageElement.classList.add('message-highlight');
      setTimeout(() => {
        messageElement.classList.remove('message-highlight');
      }, 200);
    }
  };
  
  useEffect(() => {
    const calculatePdfPositionAndScale = () => {
      if (pdfContainerRef.current) {
        const pdfCanvas = pdfContainerRef.current.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement | null;
        
        if (pdfCanvas && pdfDimensions.width > 0) {
          const containerRect = pdfContainerRef.current.getBoundingClientRect();
          const canvasRect = pdfCanvas.getBoundingClientRect();
          
          const top = canvasRect.top - containerRect.top;
          const left = canvasRect.left - containerRect.left;
          setPdfPosition({ top, left });
          
          const newScaleFactor = canvasRect.width / pdfDimensions.width;
          setScaleFactor(newScaleFactor);
        }
      }
    };
    
    calculatePdfPositionAndScale();
    
    const resizeObserver = new ResizeObserver(() => {
      calculatePdfPositionAndScale();
    });
    
    if (pdfContainerRef.current) {
      resizeObserver.observe(pdfContainerRef.current);
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [pdfDimensions.width, pdfContainerRef.current]);

  useEffect(() => {
    if (textDisplayRef.current && displayedMessages.length > 0) {
      const textDisplay = textDisplayRef.current;
      textDisplay.scrollTop = textDisplay.scrollHeight;
    }
  }, [displayedMessages]);

  useEffect(() => {
    if (!videoRef.current || !audioRef.current) return;
    
    const video = videoRef.current;
    const audio = audioRef.current;
    
    const handleAudioPlaying = () => {
      setIsAudioPlaying(true);
      
      // Check if video element still exists before attempting to play
      if (videoRef.current && video.paused) {
        video.currentTime = 10;
        video.play().catch(err => {
          // Suppress expected errors when video is removed from DOM or interrupted
          if (err.name !== 'AbortError' && !err.message.includes('media was removed from the document')) {
            // Suppress non-debug logs
          }
        });
      }
    };
    
    const handleAudioPause = () => {
      setIsAudioPlaying(false);
    };
    
    const handleAudioEnded = () => {
      setIsAudioPlaying(false);
    };
    
    const handleVideoTimeUpdate = () => {
      if (video.currentTime >= 20) {
        video.currentTime = 10;
      }
      
      if (video.currentTime >= 9.9 && !isAudioPlaying) {
        video.currentTime = 0;
      }
      
      if (isAudioPlaying && video.currentTime < 10) {
        video.currentTime = 10;
      }
    };
    
    audio.addEventListener('playing', handleAudioPlaying);
    audio.addEventListener('pause', handleAudioPause);
    audio.addEventListener('ended', handleAudioEnded);
    video.addEventListener('timeupdate', handleVideoTimeUpdate);
    
    return () => {
      audio.removeEventListener('playing', handleAudioPlaying);
      audio.removeEventListener('pause', handleAudioPause);
      audio.removeEventListener('ended', handleAudioEnded);
      video.removeEventListener('timeupdate', handleVideoTimeUpdate);
    };
  }, [videoRef.current, audioRef.current, isAudioPlaying]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const onDocumentLoadError = (err: Error) => {
    toast({
      title: "PDF Error",
      description: "PDF not found or unable to load",
      variant: "destructive"
    });
  };
  
  const onPageLoadSuccess = (page: any) => {
    const { width, height } = page.originalWidth 
      ? { width: page.originalWidth, height: page.originalHeight }
      : page.getViewport({ scale: 1 });
      
    setPdfDimensions({ width, height });
    
    setTimeout(() => {
      const pdfCanvas = pdfContainerRef.current?.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement | null;
      if (pdfCanvas) {
        const containerRect = pdfContainerRef.current!.getBoundingClientRect();
        const canvasRect = pdfCanvas.getBoundingClientRect();
        
        const top = canvasRect.top - containerRect.top;
        const left = canvasRect.left - containerRect.left;
        setPdfPosition({ top, left });
        
        const newScaleFactor = canvasRect.width / width;
        setScaleFactor(newScaleFactor);
      }
    }, 100);
  };
  
  const playAudioSegment = (regionName: string, stepIndex: number) => {
    if (!audioRef.current) return;
    
    const audioPath = `/audio/${worksheetId}/${regionName}_${stepIndex + 1}.mp3`;
    
    audioRef.current.src = audioPath;
    
    audioRef.current.onerror = () => {
      setIsAudioPlaying(false);
    };
    
    audioRef.current.play().catch(err => {
      setIsAudioPlaying(false);
    });
  };
  
  const handleRegionClick = (region: RegionData) => {
    console.log('🔍 [DEBUG] Region clicked:', region.id);
    
    // Check if region has no description or empty description
    if (!region.description || region.description.length === 0) {
      return; // Do nothing if no description
    }
    
    // Check if this region has saved state in allRegionsState
    const savedRegionState = allRegionsState[region.id];
    const startingStepIndex = savedRegionState?.currentStepIndex || 0;
    
    console.log(`🔍 [DEBUG] Region ${region.id} clicked. Saved state:`, savedRegionState, `Starting at step: ${startingStepIndex}`);
    
    setCurrentStepIndex(startingStepIndex);
    
    if (region.description && region.description.length > 0) {
      // Display messages up to the saved step index
      const messagesToDisplay = region.description.slice(0, startingStepIndex + 1);
      setDisplayedMessages(messagesToDisplay);
      
      if (videoRef.current && audioAvailable) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(err => {
          // Suppress expected errors when video is removed from DOM
          if (err.name !== 'AbortError' && !err.message.includes('media was removed from the document')) {
            // Suppress non-debug logs
          }
        });
      }
      
      // Only try to play audio if it's available (based on initial check)
      if (audioAvailable) {
        setTimeout(() => {
          playAudioSegment(region.name, startingStepIndex);
        }, 500);
      }
    } else {
      setDisplayedMessages([]);
    }
    
    setActiveRegion(region);
    setIsTextMode(true);
    
    // Notify parent about text mode change
    if (onTextModeChange) {
      onTextModeChange(true);
    }
  };
  
  const handleNextStep = () => {
    if (activeRegion && activeRegion.description && currentStepIndex < activeRegion.description.length - 1) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      const nextStepIndex = currentStepIndex + 1;
      console.log('🔍 [DEBUG] Advancing to next step:', nextStepIndex, 'for region:', activeRegion.id);
      
      setCurrentStepIndex(nextStepIndex);
      
      setDisplayedMessages(prevMessages => [
        ...prevMessages,
        activeRegion.description[nextStepIndex]
      ]);
      
      // Only try to play audio if it's available (based on initial check)
      if (audioAvailable) {
        setTimeout(() => {
          playAudioSegment(activeRegion.name, nextStepIndex);
        }, 500);
      }
    }
  };
  
  const handleBackButtonClick = () => {
    setIsTextMode(false);
    
    // Notify parent about text mode change
    if (onTextModeChange) {
      onTextModeChange(false);
    }
    
    // Clear the active region and reset state when manually exiting text mode
    setActiveRegion(null);
    setCurrentStepIndex(0);
    setDisplayedMessages([]);
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    
    if (videoRef.current) {
      videoRef.current.pause();
    }
    
    setIsAudioPlaying(false);
  };

  const handleVideoContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };
  
  const hasNextStep = activeRegion?.description && currentStepIndex < activeRegion.description.length - 1;

  return (
    <div 
      className={`worksheet-container ${isTextMode ? 'text-mode' : ''}`} 
      ref={pdfContainerRef}
    >
      <audio ref={audioRef} className="hidden" />
      
      {isTextMode && (
        <Button
          onClick={handleBackButtonClick}
          className="fixed top-4 left-4 z-70 rounded-full bg-gradient-orange-magenta hover:bg-gradient-orange-magenta text-white shadow-lg"
          size="icon"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}
      
      <div className={`worksheet-pdf-container ${isTextMode ? 'hidden' : ''} ${isCurrentPageDrmProtected ? 'drm-active' : ''}`}>
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={null}
        >
          <Page
            pageNumber={pageIndex}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className={`worksheet-page ${isCurrentPageDrmProtected ? 'blurred' : ''}`}
            width={window.innerWidth > 768 ? 600 : undefined}
            onLoadSuccess={onPageLoadSuccess}
          />
        </Document>
        
        {isCurrentPageDrmProtected && !isTextMode && regions.map((region) => (
          <div
            key={`clear-${region.id}`}
            className="worksheet-clear-region"
            style={{
              position: 'absolute',
              left: `${region.x * scaleFactor + pdfPosition.left}px`,
              top: `${region.y * scaleFactor + pdfPosition.top}px`,
              width: `${region.width * scaleFactor}px`,
              height: `${region.height * scaleFactor}px`,
              overflow: 'hidden',
              zIndex: 5,
              border: '1px solid rgba(0,0,0,0.1)',
            }}
          >
            <Document
              file={pdfUrl}
              className="clear-document"
            >
              <div
                style={{
                  position: 'absolute',
                  left: `-${region.x * scaleFactor}px`,
                  top: `-${region.y * scaleFactor}px`,
                  width: `${pdfDimensions.width * scaleFactor}px`,
                  height: `${pdfDimensions.height * scaleFactor}px`,
                }}
              >
                <Page
                  pageNumber={pageIndex}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  width={window.innerWidth > 768 ? 600 : undefined}
                  className="clear-page"
                />
              </div>
            </Document>
          </div>
        ))}
        
        {regions.map((region) => (
          <div
            key={region.id}
            className="worksheet-region"
            style={{
              position: 'absolute',
              left: `${region.x * scaleFactor + pdfPosition.left}px`,
              top: `${region.y * scaleFactor + pdfPosition.top}px`,
              width: `${region.width * scaleFactor}px`,
              height: `${region.height * scaleFactor}px`,
              zIndex: 10,
            }}
            onClick={() => handleRegionClick(region)}
            title={region.name}
          />
        ))}
      </div>
      
      {activeRegion && (
        <div className={`worksheet-text-display-container ${isTextMode ? 'active' : 'hidden'}`}>
          {isTextMode && audioAvailable && (
            <video 
              ref={videoRef}
              className="video-element"
              src="/video/default.mp4"
              muted
              autoPlay
              playsInline
              preload="auto"
              onContextMenu={handleVideoContextMenu}
            />
          )}
          
          <div 
            className="worksheet-text-display"
            ref={textDisplayRef}
          >
            <div className="text-content chat-messages">
              {displayedMessages.map((message, index) => (
                <div 
                  key={index} 
                  className="chat-message"
                  onClick={() => handleMessageClick(index)}
                  data-message-index={index}
                  role="button"
                  tabIndex={0}
                  dir={getTextDirection(message)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleMessageClick(index);
                    }
                  }}
                >
                  <p>{message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasNextStep && isTextMode && (
        <Button 
          onClick={handleNextStep} 
          className="next-button"
          variant="default"
        >
          <Sparkles className="!h-6 !w-6" />
        </Button>
      )}
      
      {numPages && numPages > 0 && (
        <div className="worksheet-info">
          <p className="text-sm text-gray-500 mt-2">
            Page {pageIndex} of {numPages}
          </p>
        </div>
      )}
      
      {isCurrentPageDrmProtected && !isTextMode && (
        <div className="drm-notice">
          <p>This page has content protection enabled</p>
        </div>
      )}
    </div>
  );
};

export default WorksheetViewer;