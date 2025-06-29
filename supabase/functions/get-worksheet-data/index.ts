import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const worksheetId = url.searchParams.get('worksheetId')
    const streamPdf = url.searchParams.get('stream') === 'pdf'

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

    // If streaming PDF is requested, handle PDF streaming
    if (streamPdf) {
      try {
        // Get PDF from storage
        const { data: pdfData, error: storageError } = await supabase.storage
          .from('pdfs')
          .download(`${worksheetId}.pdf`)

        if (storageError || !pdfData) {
          console.error('PDF download error:', storageError)
          return new Response(
            JSON.stringify({ error: 'PDF file not found' }),
            { 
              status: 404, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          )
        }

        // Convert blob to array buffer
        const arrayBuffer = await pdfData.arrayBuffer()
        const contentLength = arrayBuffer.byteLength

        // Handle Range requests for progressive loading
        const rangeHeader = req.headers.get('range')
        
        if (rangeHeader) {
          const ranges = rangeHeader.replace(/bytes=/, '').split('-')
          const start = parseInt(ranges[0], 10)
          const end = ranges[1] ? parseInt(ranges[1], 10) : contentLength - 1
          const chunkSize = (end - start) + 1

          const chunk = arrayBuffer.slice(start, end + 1)

          return new Response(chunk, {
            status: 206, // Partial Content
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/pdf',
              'Content-Range': `bytes ${start}-${end}/${contentLength}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize.toString(),
              'Cache-Control': 'public, max-age=3600',
            }
          })
        } else {
          // Return full PDF
          return new Response(arrayBuffer, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/pdf',
              'Content-Length': contentLength.toString(),
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=3600',
            }
          })
        }
      } catch (error) {
        console.error('PDF streaming error:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to stream PDF' }),
          { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }
    }

    // Handle metadata requests (existing logic)
    let requestData
    if (req.method === 'POST') {
      requestData = await req.json()
    } else {
      requestData = { worksheetId }
    }

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

    // Construct streaming PDF URL
    const streamingPdfUrl = `${supabaseUrl}/functions/v1/get-worksheet-data?worksheetId=${worksheetId}&stream=pdf`

    // DRM protection logic: Only use drm_protected_pages array
    const drmProtectedPages = document.drm_protected_pages || []
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
      pdfUrl: streamingPdfUrl
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