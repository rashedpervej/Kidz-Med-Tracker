import { createClient } from '@supabase/supabase-js';

// --- SUPABASE CONFIG ---
export const supabaseUrl = 'https://lnulafutuyxnaxkteqjv.supabase.co';
export const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxudWxhZnV0dXl4bmF4a3RlcWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxODIwMzcsImV4cCI6MjA5MDc1ODAzN30.kiHKjMJPueIwCz3hYoqPvL8wxrJpkr1Mk3ASOSzRARk';

export let supabaseClient;

function initSupabase() {
    if (supabaseClient) return supabaseClient;
    
    console.log("Initializing Supabase client...");
    supabaseClient = createClient(supabaseUrl, supabaseKey);
    
    // Make it globally accessible for debugging
    window.supabaseClient = supabaseClient;
    console.log("Supabase client initialized and assigned to window.supabaseClient");
    
    return supabaseClient;
}

// --- STORAGE FUNCTIONS ---
export async function uploadImage(bucket, path, file) {
    const client = initSupabase();
    const { data, error } = await client.storage.from(bucket).upload(path, file, {
        upsert: true,
        contentType: 'image/jpeg'
    });
    if (error) throw error;
    
    const { data: { publicUrl } } = client.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
}

export async function deleteImage(bucket, path) {
    const client = initSupabase();
    const { error } = await client.storage.from(bucket).remove([path]);
    if (error) throw error;
}

// Initialize immediately
initSupabase();

// --- AUTH FUNCTIONS ---
export async function signUp(email, password) {
    const client = initSupabase();
    return await client.auth.signUp({ email, password });
}

export async function signIn(email, password) {
    const client = initSupabase();
    return await client.auth.signInWithPassword({ email, password });
}

export async function signOut() {
    const client = initSupabase();
    return await client.auth.signOut();
}

export async function resetPassword(email) {
    const client = initSupabase();
    return await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
    });
}

export async function updatePassword(newPassword) {
    const client = initSupabase();
    return await client.auth.updateUser({ password: newPassword });
}

export async function reauthenticate(password) {
    const client = initSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user || !user.email) return { error: new Error("User not authenticated") };
    return await client.auth.reauthenticateWithPassword({
        email: user.email,
        password: password
    });
}

export async function getUser() {
    const client = initSupabase();
    try {
        const { data: { user }, error } = await client.auth.getUser();
        if (error) {
            console.warn("Error fetching user:", error.message);
            
            // Handle invalid refresh token by clearing the session
            if (error.message && (error.message.includes("Refresh Token Not Found") || error.message.includes("invalid_refresh_token"))) {
                console.warn("Invalid refresh token detected. Clearing session...");
                await client.auth.signOut();
            }
            
            return null;
        }
        if (user) {
            console.log("Current Supabase User:", {
                id: user.id,
                email: user.email,
                last_sign_in: user.last_sign_in_at
            });
        } else {
            console.log("No active Supabase session found.");
        }
        return user;
    } catch (err) {
        console.error("Exception in getUser:", err);
        return null;
    }
}

export function onAuthStateChange(callback) {
    const client = initSupabase();
    console.log("Setting up Auth State Change listener...");
    return client.auth.onAuthStateChange((event, session) => {
        console.log(`Supabase Auth Event: ${event}`, session?.user ? `User: ${session.user.email}` : "No User");
        callback(event, session);
    });
}

// --- CONNECTION TEST ---
export async function testConnection() {
    try {
        const client = initSupabase();
        console.log("Testing Supabase connection...");
        
        // Try to get user first
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError) {
            console.warn("Auth check failed during connection test:", authError.message);
            
            // Handle invalid refresh token by clearing the session
            if (authError.message && (authError.message.includes("Refresh Token Not Found") || authError.message.includes("invalid_refresh_token"))) {
                console.warn("Invalid refresh token detected during connection test. Clearing session...");
                await client.auth.signOut();
            }
        }
        
        const uid = user ? user.id : null;
        
        // Simple query to check connection and table access
        let query = client.from('children').select('*').limit(1);
        if (uid) {
            query = query.eq('user_id', uid);
        }
        
        const { data, error, status } = await query;
        
        if (error) {
            console.error("Supabase connection test failed:", error.message || error.details || "Unknown error");
            console.error("Full error object:", error);
            
            if (status === 404) {
                console.error("Table 'children' not found. Please ensure your database schema is set up.");
            } else if (error.message === 'Failed to fetch' || (error.status === 0)) {
                console.error("CRITICAL: Supabase endpoint unreachable. This usually means the project is paused, the URL is wrong, or your internet is blocking it.");
                customAlert("Database connection failed. Your Supabase project might be paused. Please log in to the Supabase dashboard and restore it.", "Connection Error");
            }
            return false;
        }
        
        console.log("Supabase connection test successful! Found children data:", data);
        return true;
    } catch (err) {
        if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
            console.error("CRITICAL: Supabase endpoint unreachable (Exception). This usually means the project is paused or the URL is wrong.");
            customAlert("Cannot connect to Supabase. This often happens if the project is paused or there is a network issue.", "Connection Error");
        } else {
            console.error("Supabase connection test exception:", err);
        }
        return false;
    }
}
