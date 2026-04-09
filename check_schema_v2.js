
import { supabaseClient } from './supabase.js';

async function checkMeetsSchema() {
    const { data, error } = await supabaseClient.from('meets').select('*').limit(1);
    if (error) {
        console.error("Error fetching from meets:", error);
    } else {
        console.log("Meets columns:", data.length > 0 ? Object.keys(data[0]) : "No data in meets table yet");
    }
    
    // Try to insert a test row with all possible columns to see what sticks
    const testMeet = {
        issue_id: 1, // dummy
        date: new Date().toISOString(),
        doctor: "Test Dr",
        center: "Test Center",
        notes: "Test Notes",
        prescriptions: ["http://example.com/1.jpg"],
        medicine_ids: ["1", "2"]
    };
    
    const { error: insertError } = await supabaseClient.from('meets').insert([testMeet]);
    if (insertError) {
        console.log("Insert failed, likely missing columns:", insertError.message);
    } else {
        console.log("Insert succeeded! All columns exist.");
    }
}

checkMeetsSchema();
