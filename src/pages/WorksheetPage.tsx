import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import WorksheetViewer from "@/components/WorksheetViewer";
import AIChatButton from "@/components/AIChatButton";
import { Button } from "@/components/ui/button";
import { useWorksheetData } from "@/hooks/useWorksheetData";
import type { RegionData } from "@/types/worksheet";

interface StoredRegionData {
  currentStepIndex: number;
}

interface SessionPageData {
  lastActiveRegionId: string | null;
  regions: Record<string, StoredRegionData>;
}

const WorksheetPage: React.FC = () => {
  const { id, n } = useParams<{ id: string; n: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [isTextModeActive, setIsTextModeActive] = useState(false);
  const [currentActiveRegion, setCurrentActiveRegion] = useState<RegionData | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [allRegionsState, setAllRegionsState] = useState<Record<string, StoredRegionData>>({});
  const [initialActiveRegion, setInitialActiveRegion] = useState<RegionData | null>(null);
  const [initialCurrentStepIndex, setInitialCurrentStepIndex] = useState<number>(0);
  
  // Get initial state from navigation (when returning from AI chat)
  const locationState = location.state as { 
    initialActiveRegion?: RegionData; 
    initialCurrentStepIndex?: number; 
  } | null;
  
  // Fetch worksheet data once at the page level
  const { data: worksheetData, isLoading, error } = useWorksheetData(id || '');
  
  // Enable zooming for worksheet page
  useEffect(() => {
    const viewportMeta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement;
    if (viewportMeta) {
      // Store original viewport content
      const originalContent = viewportMeta.content;
      
      // Enable zooming for worksheet page
      viewportMeta.content = "width=device-width, initial-scale=1.0, user-scalable=yes, maximum-scale=5.0";
      
      // Cleanup function to restore original viewport when component unmounts
      return () => {
        if (viewportMeta) {
          viewportMeta.content = originalContent;
        }
      };
    }
  }, []);
  
  // Control zooming based on text mode state
  useEffect(() => {
    const viewportMeta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement;
    if (viewportMeta) {
      if (isTextModeActive) {
        // Disable zooming and reset zoom when entering text/audio/video mode
        viewportMeta.content = "width=device-width, initial-scale=1.0, user-scalable=no, maximum-scale=1.0";
        console.log('Zoom disabled and reset due to text mode activation');
      } else {
        // Re-enable zooming when exiting text/audio/video mode
        viewportMeta.content = "width=device-width, initial-scale=1.0, user-scalable=yes, maximum-scale=5.0";
        console.log('Zoom re-enabled due to text mode deactivation');
      }
    }
  }, [isTextModeActive]);
  
  // Load session state when worksheet or page changes
  useEffect(() => {
    if (!id || !n) return;
    
    const sessionKey = `worksheet_page_state_${id}_${n}`;
    console.log('🔍 [DEBUG] Loading session state with key:', sessionKey);
    
    try {
      const storedState = sessionStorage.getItem(sessionKey);
      console.log('🔍 [DEBUG] Raw stored state from sessionStorage:', storedState);
      
      if (storedState) {
        const parsedState = JSON.parse(storedState) as SessionPageData;
        console.log('🔍 [DEBUG] Parsed session state:', parsedState);
        
        // Set all regions state
        setAllRegionsState(parsedState.regions || {});
        console.log('🔍 [DEBUG] Set allRegionsState to:', parsedState.regions || {});
        
        // If we have location state (from AI chat), prioritize that
        if (locationState?.initialActiveRegion) {
          console.log('🔍 [DEBUG] Using location state - initialActiveRegion:', locationState.initialActiveRegion);
          setInitialActiveRegion(locationState.initialActiveRegion);
          setInitialCurrentStepIndex(locationState.initialCurrentStepIndex || 0);
        } else if (parsedState.lastActiveRegionId && worksheetData?.meta?.regions) {
          // Find the last active region from the stored data
          const lastActiveRegion = worksheetData.meta.regions.find(
            region => region.id === parsedState.lastActiveRegionId
          );
          if (lastActiveRegion) {
            const regionState = parsedState.regions[parsedState.lastActiveRegionId];
            console.log('🔍 [DEBUG] Found last active region:', lastActiveRegion.id, 'with state:', regionState);
            setInitialActiveRegion(lastActiveRegion);
            setInitialCurrentStepIndex(regionState?.currentStepIndex || 0);
          }
        }
      } else {
        console.log('🔍 [DEBUG] No session state found for key:', sessionKey);
        setAllRegionsState({});
        
        // Use location state if available
        if (locationState?.initialActiveRegion) {
          console.log('🔍 [DEBUG] Using location state (no session) - initialActiveRegion:', locationState.initialActiveRegion);
          setInitialActiveRegion(locationState.initialActiveRegion);
          setInitialCurrentStepIndex(locationState.initialCurrentStepIndex || 0);
        }
      }
    } catch (error) {
      console.warn('🔍 [DEBUG] Failed to load session state:', error);
      setAllRegionsState({});
      
      // Use location state if available
      if (locationState?.initialActiveRegion) {
        console.log('🔍 [DEBUG] Using location state (error fallback) - initialActiveRegion:', locationState.initialActiveRegion);
        setInitialActiveRegion(locationState.initialActiveRegion);
        setInitialCurrentStepIndex(locationState.initialCurrentStepIndex || 0);
      }
    }
  }, [id, n, locationState, worksheetData]);
  
  const goBack = () => {
    navigate("/");
  };

  // Memoize the handleRegionStateChange function to prevent unnecessary re-renders
  const handleRegionStateChange = useCallback((region: RegionData | null, stepIndex: number) => {
    console.log('🔍 [DEBUG] handleRegionStateChange called with region:', region?.id, 'stepIndex:', stepIndex);
    
    // Only update state if there's an actual change
    setCurrentActiveRegion(prevRegion => {
      const regionChanged = prevRegion?.id !== region?.id;
      if (regionChanged) {
        console.log('🔍 [DEBUG] Region changed from', prevRegion?.id, 'to', region?.id);
      }
      return regionChanged ? region : prevRegion;
    });
    
    setCurrentStepIndex(prevStepIndex => {
      const stepChanged = prevStepIndex !== stepIndex;
      if (stepChanged) {
        console.log('🔍 [DEBUG] Step index changed from', prevStepIndex, 'to', stepIndex);
      }
      return stepChanged ? stepIndex : prevStepIndex;
    });
    
    // Update all regions state and save to session storage
    if (id && n) {
      const sessionKey = `worksheet_page_state_${id}_${n}`;
      console.log('🔍 [DEBUG] Using session key for save:', sessionKey);
      
      // Use functional update to ensure we have the latest state
      setAllRegionsState(currentAllRegionsState => {
        console.log('🔍 [DEBUG] Current allRegionsState before update:', currentAllRegionsState);
        
        if (region) {
          // Update the state for this specific region
          const updatedAllRegionsState = {
            ...currentAllRegionsState,
            [region.id]: {
              currentStepIndex: stepIndex
            }
          };
          console.log('🔍 [DEBUG] Updated region state for:', region.id, 'with stepIndex:', stepIndex);
          
          const stateToSave: SessionPageData = {
            lastActiveRegionId: region.id,
            regions: updatedAllRegionsState
          };
          
          console.log('🔍 [DEBUG] About to save state to sessionStorage:', stateToSave);
          
          try {
            sessionStorage.setItem(sessionKey, JSON.stringify(stateToSave));
            console.log('🔍 [DEBUG] Successfully saved state to sessionStorage with key:', sessionKey);
            
            // Verify the save by immediately reading it back
            const verifyState = sessionStorage.getItem(sessionKey);
            console.log('🔍 [DEBUG] Verification - state read back from sessionStorage:', verifyState);
          } catch (error) {
            console.warn('🔍 [DEBUG] Failed to save page state to session:', error);
          }
          
          console.log('🔍 [DEBUG] Returning updated allRegionsState:', updatedAllRegionsState);
          return updatedAllRegionsState;
        } else {
          // When no active region, check if we need to update sessionStorage
          try {
            const currentStoredState = sessionStorage.getItem(sessionKey);
            let currentSessionData: SessionPageData | null = null;
            
            if (currentStoredState) {
              currentSessionData = JSON.parse(currentStoredState);
            }
            
            // Only update sessionStorage if lastActiveRegionId is not already null
            if (currentSessionData?.lastActiveRegionId !== null) {
              const stateToSave: SessionPageData = {
                lastActiveRegionId: null,
                regions: currentAllRegionsState
              };
              
              console.log('🔍 [DEBUG] About to save state (no active region) to sessionStorage:', stateToSave);
              
              sessionStorage.setItem(sessionKey, JSON.stringify(stateToSave));
              console.log('🔍 [DEBUG] Successfully updated last active region in session with key:', sessionKey);
              
              // Verify the save by immediately reading it back
              const verifyState = sessionStorage.getItem(sessionKey);
              console.log('🔍 [DEBUG] Verification - state read back from sessionStorage:', verifyState);
            } else {
              console.log('🔍 [DEBUG] No sessionStorage update needed - lastActiveRegionId already null');
            }
          } catch (error) {
            console.warn('🔍 [DEBUG] Failed to update session state:', error);
          }
          
          console.log('🔍 [DEBUG] Returning unchanged allRegionsState:', currentAllRegionsState);
          // Return the same object reference to prevent unnecessary re-renders
          return currentAllRegionsState;
        }
      });
    }
  }, [id, n]); // Only depend on id and n, which are stable

  if (!id || !n) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold text-red-500 mb-4">
          Missing worksheet information
        </h1>
        <Button onClick={goBack} className="bg-gradient-orange-magenta hover:bg-gradient-orange-magenta text-white">
          Return to Scanner
        </Button>
      </div>
    );
  }

  const pageIndex = parseInt(n, 10);
  
  if (isNaN(pageIndex)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold text-red-500 mb-4">
          Invalid page number
        </h1>
        <Button onClick={goBack} className="bg-gradient-orange-magenta hover:bg-gradient-orange-magenta text-white">
          Return to Scanner
        </Button>
      </div>
    );
  }

  // Show loading state while fetching data
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="text-center">
          <p className="text-lg">Loading worksheet...</p>
        </div>
      </div>
    );
  }

  // Show error if worksheet not found
  if (error || !worksheetData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">
            {error?.message || "Worksheet not found"}
          </h1>
          <Button onClick={goBack} className="bg-gradient-orange-magenta hover:bg-gradient-orange-magenta text-white">
            Return to Scanner
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <WorksheetViewer 
        worksheetId={id} 
        pageIndex={pageIndex} 
        worksheetMeta={worksheetData.meta}
        pdfUrl={worksheetData.pdfUrl}
        onTextModeChange={setIsTextModeActive}
        initialActiveRegion={initialActiveRegion}
        initialCurrentStepIndex={initialCurrentStepIndex}
        onRegionStateChange={handleRegionStateChange}
        allRegionsState={allRegionsState}
      />
      <AIChatButton 
        worksheetId={id} 
        pageNumber={pageIndex} 
        isTextModeActive={isTextModeActive}
        activeRegion={currentActiveRegion}
        currentStepIndex={currentStepIndex}
        pdfUrl={worksheetData.pdfUrl}
        worksheetMeta={worksheetData.meta}
      />
    </div>
  );
};

export default WorksheetPage;