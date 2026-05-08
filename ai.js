import { GoogleGenAI, Type } from "@google/genai";
import { showLoading, customAlert, openModal, closeModal } from './ui.js';

let aiInstance = null;

function getAI() {
    if (!aiInstance) {
        // AI Studio usually provides GEMINI_API_KEY in the environment
        // Vite uses import.meta.env for VITE_ prefixed variables
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : null);
        
        if (!apiKey) {
            console.error("GEMINI_API_KEY is not set.");
            return null;
        }
        aiInstance = new GoogleGenAI(apiKey);
    }
    return aiInstance;
}

export async function analyzePrescription(imageUrl) {
    const ai = getAI();
    if (!ai) {
        customAlert("AI service is not configured (missing API key).");
        return null;
    }

    showLoading(true);
    try {
        // Fetch image data and convert to base64
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
        });

        const prompt = `Analyze this prescription image and extract medicine details. 
        Return a list of medicines with their names, dosage, frequency (e.g., twice a day), and suggested times (in HH:MM format).
        If multiple medicines are found, return them all.
        Be as accurate as possible, but if a field is unclear, leave it empty.
        
        Recommended times:
        - Once a day: 08:00
        - Twice a day: 08:00, 20:00
        - Three times a day: 08:00, 14:00, 20:00
        - Four times a day: 08:00, 12:00, 16:00, 20:00`;

        const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { inlineData: { data: base64Data, mimeType: blob.type } },
                    { text: prompt }
                ]
            }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        medicines: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    dosageValue: { type: Type.STRING, description: "Just the number part of dosage, e.g. 2.5" },
                                    dosageUnit: { type: Type.STRING, description: "The unit, e.g. ml, mg, drops, etc" },
                                    frequency: { type: Type.STRING },
                                    times: { 
                                        type: Type.ARRAY, 
                                        items: { type: Type.STRING },
                                        description: "Array of times in HH:MM format"
                                    },
                                    durationDays: { type: Type.NUMBER, description: "Suggested duration in days" }
                                },
                                required: ["name"]
                            }
                        }
                    }
                }
            }
        });

        const data = JSON.parse(result.text);
        return data.medicines || [];
    } catch (err) {
        console.error("AI Analysis failed:", err);
        customAlert("Failed to analyze prescription using AI.");
        return null;
    } finally {
        showLoading(false);
    }
}

let pendingAIResults = [];

export function showAIResults(medicines) {
    const container = document.getElementById('ai-results-container');
    if (!container) return;
    
    pendingAIResults = medicines;
    container.innerHTML = '';

    if (!medicines || medicines.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding: 20px;">No medicines detected in the image.</p>';
        return;
    }

    medicines.forEach((med, index) => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '15px';
        div.style.padding = '15px';
        div.style.border = '1px solid rgba(var(--primary-rgb), 0.1)';
        
        div.innerHTML = `
            <div style="display: flex; gap: 12px; align-items: flex-start;">
                <input type="checkbox" id="ai-check-${index}" checked style="width: 20px; height: 20px; margin-top: 2px;">
                <div style="flex: 1;">
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label style="font-size: 11px;">Medicine Name</label>
                        <input type="text" id="ai-name-${index}" value="${med.name || ''}" class="btn-small" style="width: 100%; border-radius: 8px;">
                    </div>
                    <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                        <div class="form-group" style="flex: 1; margin: 0;">
                            <label style="font-size: 11px;">Dosage</label>
                            <input type="text" id="ai-dosage-${index}" value="${med.dosageValue || ''}" class="btn-small" style="width: 100%; border-radius: 8px;">
                        </div>
                        <div class="form-group" style="flex: 1; margin: 0;">
                            <label style="font-size: 11px;">Unit</label>
                            <select id="ai-unit-${index}" class="btn-small" style="width: 100%; border-radius: 8px;">
                                <option value="ml" ${med.dosageUnit === 'ml' ? 'selected' : ''}>ml</option>
                                <option value="mg" ${med.dosageUnit === 'mg' ? 'selected' : ''}>mg</option>
                                <option value="drops" ${med.dosageUnit === 'drops' ? 'selected' : ''}>drops</option>
                                <option value="pills" ${med.dosageUnit === 'pills' ? 'selected' : ''}>pills</option>
                                <option value="tsp" ${med.dosageUnit === 'tsp' ? 'selected' : ''}>tsp</option>
                                <option value="tbsp" ${med.dosageUnit === 'tbsp' ? 'selected' : ''}>tbsp</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label style="font-size: 11px;">Frequency / Times</label>
                        <input type="text" id="ai-times-${index}" value="${(med.times || []).join(', ')}" placeholder="08:00, 20:00" class="btn-small" style="width: 100%; border-radius: 8px;">
                    </div>
                    <div class="form-group" style="margin: 0;">
                        <label style="font-size: 11px;">Duration (Days)</label>
                        <input type="number" id="ai-duration-${index}" value="${med.durationDays || 7}" class="btn-small" style="width: 100%; border-radius: 8px;">
                    </div>
                </div>
            </div>
        `;
        container.appendChild(div);
    });

    openModal('modal-ai-preview');
}

export async function confirmAIResults() {
    const selectedMeds = [];
    pendingAIResults.forEach((_, index) => {
        const isChecked = document.getElementById(`ai-check-${index}`).checked;
        if (isChecked) {
            const name = document.getElementById(`ai-name-${index}`).value.trim();
            const dosageValue = document.getElementById(`ai-dosage-${index}`).value.trim();
            const dosageUnit = document.getElementById(`ai-unit-${index}`).value;
            const timesStr = document.getElementById(`ai-times-${index}`).value.trim();
            const durationArr = parseInt(document.getElementById(`ai-duration-${index}`).value) || 7;
            
            const times = timesStr.split(',').map(s => s.trim()).filter(s => /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(s));
            
            if (name && times.length > 0) {
                selectedMeds.push({
                    name,
                    dosage: `${dosageValue} ${dosageUnit}`,
                    dosageValue,
                    dosageUnit,
                    times,
                    durationDays: durationArr
                });
            }
        }
    });

    if (selectedMeds.length === 0) {
        return customAlert("Please select at least one medicine with valid times.");
    }

    closeModal('modal-ai-preview');
    
    // Now trigger saving these medicines
    // We need to pass them to window.saveManyMeds or similar
    if (window.handleAIResultsConfirmed) {
        window.handleAIResultsConfirmed(selectedMeds);
    }
}

window.confirmAIResults = confirmAIResults;
