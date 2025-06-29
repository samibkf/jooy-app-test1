import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { worksheetId } = await req.json()

    if (!worksheetId) {
      return new Response(
        JSON.stringify({ error: 'Worksheet ID is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch document metadata from 'documents' table
    const { data: document, error: documentError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', worksheetId)
      .single()

    if (documentError) {
      console.error('Document fetch error:', documentError)
      return new Response(
        JSON.stringify({ error: 'Document not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Fetch regions from 'document_regions' table using document_id
    const { data: regions, error: regionsError } = await supabase
      .from('document_regions')
      .select('*')
      .eq('document_id', worksheetId)
      .order('page', { ascending: true })

    if (regionsError) {
      console.error('Document regions fetch error:', regionsError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch document regions' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Get PDF URL from 'pdfs' storage bucket with 24 hour expiry
    const { data: pdfData, error: storageError } = await supabase.storage
      .from('pdfs')
      .createSignedUrl(`${worksheetId}.pdf`, 86400) // 24 hours expiry

    let pdfUrl = null
    if (pdfData?.signedUrl && !storageError) {
      pdfUrl = pdfData.signedUrl
    }

    // If no signed URL could be generated, pdfUrl remains null
    if (!pdfUrl) {
      console.warn(`PDF file not found in storage for worksheet: ${worksheetId}`)
      return new Response(
        JSON.stringify({ error: 'PDF file not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // DRM protection logic: Only use drm_protected_pages array
    // The is_private flag is ignored for DRM protection
    const drmProtectedPages = document.drm_protected_pages || []
    
    // drmProtected is always false - only specific pages in drmProtectedPages array are protected
    const drmProtected = false

    // Transform data to match expected format
    const responseData = {
      meta: {
        documentName: document.name,
        documentId: document.id,
        drmProtectedPages: drmProtectedPages,
        drmProtected: drmProtected,
        regions: regions?.map(region => ({
          id: region.id,
          document_id: document.id,
          user_id: region.user_id,
          page: region.page,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          type: region.type,
          name: region.name,
          description: region.description || [],
          created_at: region.created_at
        })) || []
      },
      pdfUrl
    }

    return new Response(
      JSON.stringify(responseData),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})