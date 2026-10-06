const fs = require('fs');
const path = require('path');
const PolicyMapping = require('../models/PolicyMapping');

/**
 * Deterministic Mapping Engine
 * Resolves legal sections and platform policies based on category.
 * Now dynamic: Fetches from MongoDB (cached).
 */
class MappingService {
    constructor() {
        this.mappingData = { category_mappings: [] }; // Initial empty state
        this.isLoaded = false;

        // Initial load
        this.loadMappings();

        // Refresh cache every 5 minutes (optional, can be triggered manually too)
        setInterval(() => this.loadMappings(), 5 * 60 * 1000);
    }

    async loadMappings() {
        try {
            const mappings = await PolicyMapping.find({ is_active: true });

            // Transform DB format back to service internal format
            this.mappingData.category_mappings = mappings.map(m => ({
                category_id: m.category_id,
                definition: m.definition,
                country: 'IN', // Default
                legal_sections: m.legal_sections,
                platform_policies: m.platform_policies instanceof Map ?
                    Object.fromEntries(m.platform_policies) : m.platform_policies // Handle Mongoose Map
            }));

            this.isLoaded = true;
            console.log(`[MappingService] Successfully loaded ${mappings.length} category mappings from MongoDB.`);
        } catch (error) {
            console.error('[MappingService] Error loading mapping data from DB:', error.message);
            // Fallback to file if DB fails on startup? 
            // Better to keep previous cache if update fails
            if (!this.isLoaded) {
                this.loadFallbackFile();
            }
        }
    }

    async waitForLoad() {
        if (this.isLoaded) return;
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (this.isLoaded) {
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });
    }

    loadFallbackFile() {
        try {
            const dataPath = path.join(__dirname, '../config/mapping_data.json');
            const rawData = fs.readFileSync(dataPath, 'utf8');
            this.mappingData = JSON.parse(rawData);
            console.log(`[MappingService] Loaded fallback file data.`);
            this.isLoaded = true;
        } catch (e) { console.error("Fallback load failed", e); }
    }

    // Method to force refresh (e.g., after Admin API update)
    async forceRefresh() {
        console.log("[MappingService] Force refreshing mappings...");
        await this.loadMappings();
    }

    /**
     * Resolve legal and policy violations for a given category.
     * @param {string} category - The detected category (e.g., "Hate_Speech")
     * @param {string} text - The input text to extract keywords from.
     * @param {string} platform - The source platform (e.g., "x", "youtube")
     * @param {string} country - The target country (default: "IN")
     * @returns {object} { legal_sections: [], platform_policies: [], triggered_keywords: [] }
     */
    resolveMapping(category, text, platform = 'x', country = 'IN') {
        const platformKey = platform.toLowerCase();

        // Find mapping for category and country
        const mapping = this.mappingData.category_mappings.find(
            m => m.category_id === category && m.country === country
        );

        const result = {
            legal_sections: [],
            platform_policies: [],
            triggered_keywords: []
        };

        if (mapping) {
            result.legal_sections = (mapping.legal_sections || []).map(s => ({
                act: country === 'IN' ? 'BNS 2023' : 'International Law',
                section: s.code,
                description: s.title
            }));

            // Handle both Map object and plain object in case of different load states
            const policiesMap = mapping.platform_policies;
            const policies = policiesMap[platformKey] || [];

            result.platform_policies = policies.map(p => ({
                policy_id: p.id,
                policy_name: p.name,
                platform: platformKey
            }));
        } else {
            console.warn(`[MappingService] No mapping found for category: ${category} (Country: ${country})`);
        }

        // Always extract keywords for explainability, regardless of mapping
        result.triggered_keywords = this.extractKeywords(text);

        return result;
    }

    extractKeywords(text) {
        if (!text) return [];
        const text_norm = text.toLowerCase();
        const keywords_found = new Set();

        const KR_MAP = {
            "violence": ["kill", "murder", "attack", "wipe out", "revolt", "overthrow", "weapons", "terrorism", "extremist", "bomb", "explode", "sovereignty", "integrity", "मारतलो", "जीवे मारीन", "हल्लो", "हल्ला", "मारो", "बम"],
            "sexual": ["rape", "sex", "modesty", "nudity", "porn", "बलात्कार", "विनयभंग", "अत्याचार"],
            "hate": ["scum", "drive them out", "dehumanizing", "hateful conduct", "promoting enmity", "हाकलून दिया", "भायलो", "भगाओ", "नीच", "कुत्रे"],
            "harassment": ["idiot", "stupid", "moron", "useless", "shut up", "मूर्ख", "येडो", "बेवकूफ", "चोर"],
            "religious": ["religion", "god", "mulla", "temple", "mosque", "church", "prophet", "idol", "blasphemy", "देव", "देऊळ", "मशीद", "चर्च", "धर्म", "भगवान", "मंदिर"],
            "communal": ["hindu", "muslim", "christian", "dalit", "brahmin", "caste", "minority", "majority", "जात", "जाती", "ख्रिस्ती", "हिंदू", "मुस्लिम"],
            "privacy": ["address", "phone number", "aadhaar", "ssn", "passport", "पत्तो", "पत्ता", "फोन नंबर", "आधार", "पता"],
            "civic": ["election", "vote", "voter card", "evm", "rigging", "misinformation", "वेंचणूक", "निवडणूक", "मतदान", "चुनाव", "वोट"]
        };

        for (const cat in KR_MAP) {
            for (const kw of KR_MAP[cat]) {
                if (text_norm.includes(kw.toLowerCase())) {
                    keywords_found.add(kw);
                }
            }
        }
        return Array.from(keywords_found).sort();
    }
}

module.exports = new MappingService();
