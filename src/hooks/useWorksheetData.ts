import { useQuery } from '@tanstack/react-query'
import { supabase, shouldUseSupabase } from '@/lib/supabase'
import type { WorksheetMetadata } from '@/types/worksheet'

interface WorksheetDataResponse {
  meta: WorksheetMetadata;
  pdfUrl: string;
}

export const useWorksheetData = (worksheetId: string) => {
  return useQuery({
    queryKey: ['worksheet', worksheetId],
    queryFn: async (): Promise<WorksheetDataResponse> => {
      // If Supabase is not configured, fallback to JSON files
      if (!shouldUseSupabase()) {
        console.log('Supabase not configured, using JSON fallback')
        const response = await fetch(`/data/${worksheetId}.json`)
        if (!response.ok) {
          throw new Error(`Failed to fetch worksheet data: ${response.status}`)
        }
        const jsonData = await response.json()
        return {
          meta: jsonData,
          pdfUrl: `/pdfs/${worksheetId}.pdf`
        }
      }

      // Use Supabase edge function to get both metadata and PDF URL
      const { data, error } = await supabase.functions.invoke('get-worksheet-data', {
        body: { worksheetId },
      });

      if (error) {
        throw new Error(`Failed to fetch worksheet: ${error.message}`)
      }

      if (!data?.meta || !data?.pdfUrl) {
        throw new Error('Invalid response from worksheet data function')
      }

      return {
        meta: data.meta,
        pdfUrl: data.pdfUrl
      }
    },
    enabled: !!worksheetId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: (failureCount, error) => {
      // Don't retry if it's a 404 or if Supabase is not configured
      if (error.message.includes('404') || !shouldUseSupabase()) {
        return false
      }
      return failureCount < 3
    }
  })
}

export const useRegionsByPage = (worksheetId: string, pageNumber: number) => {
  return useQuery({
    queryKey: ['regions', worksheetId, pageNumber],
    queryFn: async () => {
      // If Supabase is not configured, fallback to JSON files
      if (!shouldUseSupabase()) {
        const response = await fetch(`/data/${worksheetId}.json`)
        if (!response.ok) {
          throw new Error(`Failed to fetch worksheet data: ${response.status}`)
        }
        const data = await response.json()
        return data.regions?.filter((region: any) => region.page === pageNumber) || []
      }

      // Use Supabase if configured
      const { data, error } = await supabase
        .from('regions')
        .select('*')
        .eq('worksheet_id', worksheetId)
        .eq('page', pageNumber)
        .order('created_at', { ascending: true })

      if (error) {
        throw new Error(`Failed to fetch regions: ${error.message}`)
      }

      return data || []
    },
    enabled: !!worksheetId && !!pageNumber,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}