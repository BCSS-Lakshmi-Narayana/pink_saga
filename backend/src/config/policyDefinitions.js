export const PLATFORM_POLICIES = {
    twitter: {
        name: "Twitter (X)",
        description: "X's rules on safety, privacy, and authenticity.",
        categories: {
            HATEFUL_CONDUCT: {
                id: "HATEFUL_CONDUCT",
                name: "Hateful Conduct",
                description: "You may not promote violence against or directly attack or threaten other people on the basis of race, ethnicity, national origin, caste, sexual orientation, gender, gender identity, religious affiliation, age, disability, or serious disease. We also do not allow accounts whose primary purpose is inciting harm towards others on the basis of these categories.",
                examples: [
                    "Violent threats",
                    "Hateful imagery",
                    "Slurs and tropes",
                    "Dehumanization"
                ]
            },
            ABUSE_HARASSMENT: {
                id: "ABUSE_HARASSMENT",
                name: "Abuse and Harassment",
                description: "You may not engage in the targeted harassment of someone, or incite other people to do so. This includes wishing or hoping that someone experiences physical harm.",
                examples: [
                    "Unwanted sexual advances",
                    "Denial of violent events",
                    "Targeted harassment",
                    "Inciting harassment"
                ]
            },
            VIOLENT_SPEECH: {
                id: "VIOLENT_SPEECH",
                name: "Violent Speech",
                description: "You may not incite, promote, or encourage violence against anyone.",
                examples: [
                    "Threats of violence",
                    "Glorification of violence",
                    "Incitement to violence"
                ]
            },
            SENSITIVE_MEDIA: {
                id: "SENSITIVE_MEDIA",
                name: "Sensitive Media",
                description: "You may not post media that is excessively gory or shares violent or adult content within live video or in profile header, list banner, or community cover images. Media depicting sexual violence and assault is also not permitted.",
                examples: [
                    "Graphic violence",
                    "Adult content",
                    "Violent sexual conduct"
                ]
            },
            PRIVATE_INFORMATION: {
                id: "PRIVATE_INFORMATION",
                name: "Private Information (Doxxing)",
                description: "You may not publish or post other people's private information (such as home phone number and address) without their express authorization and permission. We also prohibit threatening to expose private information or incentivizing others to do so.",
                examples: [
                    "Home address",
                    "Phone numbers",
                    "Financial info",
                    "ID documents"
                ]
            },
            SYNTHETIC_MANIPULATED_MEDIA: {
                id: "SYNTHETIC_MANIPULATED_MEDIA",
                name: "Synthetic and Manipulated Media",
                description: "You may not share synthetic, manipulated, or out-of-context media that may deceive or confuse people and lead to harm ('misleading media').",
                examples: [
                    "Deepfakes",
                    "Doctoring media to change meaning",
                    "Deceptive edits"
                ]
            }
        }
    },
    meta: {
        name: "Meta (Facebook/Instagram)",
        description: "Meta's Community Standards on safety, violence, and objectionable content.",
        categories: {
            VIOLENCE_INCITEMENT: {
                id: "VIOLENCE_INCITEMENT",
                name: "Violence and Incitement",
                description: "We remove content, disable accounts, and work with law enforcement when we believe there is a genuine risk of physical harm or direct threats to public safety. Content that threatens serious violence or promotes it is not allowed."
            },
            DANGEROUS_ORGANIZATIONS: {
                id: "DANGEROUS_ORGANIZATIONS",
                name: "Dangerous Individuals and Organizations",
                description: "We do not allow organizations or individuals that proclaim a violent mission or are engaged in violence to have a presence on our platforms. This includes terrorist organizations, hate groups, and criminal organizations."
            },
            BULLYING_HARASSMENT: {
                id: "BULLYING_HARASSMENT",
                name: "Bullying and Harassment",
                description: "We do not tolerate bullying or harassment. This includes targeting individuals with unwanted contact, attacks on their character, or sexual harassment."
            },
            HATE_SPEECH: {
                id: "HATE_SPEECH",
                name: "Hate Speech",
                description: "We do not allow hate speech on Facebook. It creates an environment of intimidation and exclusion and in some cases may promote real-world violence. We define hate speech as a direct attack on people based on what we call protected characteristics—race, ethnicity, national origin, religious affiliation, sexual orientation, caste, sex, gender, gender identity, and serious disease or disability."
            },
            SEXUAL_EXPLOITATION: {
                id: "SEXUAL_EXPLOITATION",
                name: "Sexual Exploitation",
                description: "We do not allow content that sexualizes children or non-consenting adults. This includes non-consensual intimate imagery (NCII)."
            },
            MISINFORMATION: {
                id: "MISINFORMATION",
                name: "Misinformation",
                description: "We remove misinformation where it is likely to directly contribute to the risk of imminent physical harm. We also reduce the distribution of content rated false by independent fact-checkers."
            }
        }
    },
    youtube: {
        name: "YouTube",
        description: "YouTube's Community Guidelines on safety and sensitive content.",
        categories: {
            HARASSMENT_CYBERBULLYING: {
                id: "HARASSMENT_CYBERBULLYING",
                name: "Harassment & Cyberbullying",
                description: "Content that threatens individuals is not allowed on YouTube. We also don't allow content that targets an individual with prolonged or malicious insults based on intrinsic attributes."
            },
            HATE_SPEECH: {
                id: "HATE_SPEECH",
                name: "Hate Speech",
                description: "Content promoting violence or hatred against individuals or groups based on certain attributes (e.g., age, caste, disability, ethnicity, gender, etc.) is not allowed."
            },
            VIOLENT_CRIMINAL_ORGS: {
                id: "VIOLENT_CRIMINAL_ORGS",
                name: "Violent Criminal Organizations",
                description: "Content intended to praise, promote, or aid violent criminal organizations is not allowed on YouTube."
            },
            VIOLENT_GRAPHIC_CONTENT: {
                id: "VIOLENT_GRAPHIC_CONTENT",
                name: "Violent or Graphic Content",
                description: "Violent or gory content intended to shock or disgust viewers, or content encouraging others to commit violent acts, is not allowed."
            },
            MISINFORMATION: {
                id: "MISINFORMATION",
                name: "Misinformation",
                description: "Content that spreads false or misleading information that can cause significant harm (e.g., medical misinformation, election misinformation) is not allowed."
            }
        }
    }
};

export const LEGAL_SECTIONS = {
    BNS_2023: {
        name: "Bharatiya Nyaya Sanhita (BNS), 2023",
        sections: {
            "152": {
                id: "152",
                description: "Act endangering sovereignty, unity and integrity of India (Sedition/Subversive Activities).",
                keywords: ["endangering sovereignty", "threat to unity", "threat to integrity", "sedition", "secession", "armed rebellion"]
            },
            "196": {
                id: "196",
                description: "Promoting enmity between different groups on grounds of religion, race, place of birth, residence, language, etc., and doing acts prejudicial to maintenance of harmony.",
                keywords: ["promoting enmity", "religious hatred", "racial hatred", "disturbing harmony", "communal disharmony", "communal violence"]
            },
            "197": {
                id: "197",
                description: "Imputations, assertions prejudicial to national-integration.",
                keywords: ["prejudicial to national integration", "anti-national assertion"]
            },
            "299": {
                id: "299",
                description: "Deliberate and malicious acts, intended to outrage religious feelings of any class by insulting its religion or religious beliefs.",
                keywords: ["outraging religious feelings", "insulting religion", "blasphemy", "malicious religious insult"]
            },
            "351": {
                id: "351",
                description: "Criminal intimidation (Threatening to cause injury to person, reputation or property).",
                keywords: ["criminal intimidation", "threat to release info", "threat to injure", "threat of alarm"]
            },
            "352": {
                id: "352",
                description: "Intentional insult with intent to provoke breach of peace.",
                keywords: ["intentional insult", "provoking breach of peace", "inciting disturbance"]
            },
            "356": {
                id: "356",
                description: "Defamation (Making or publishing any imputation concerning any person intending to harm reputation).",
                keywords: ["defamation", "harming reputation", "libel", "slander"]
            },
            "79": {
                id: "79",
                description: "Word, gesture or act intended to insult the modesty of a woman.",
                keywords: ["insulting modesty of woman", "sexual harassment", "intrusive privacy violation"]
            }
        }
    },
    IT_ACT_2000: {
        name: "Information Technology Act, 2000",
        sections: {
            "66A": {
                id: "66A",
                description: "(Struck down, but historically relevant context) Punishment for sending offensive messages through communication service.",
                note: "Struck down by Supreme Court in Shreya Singhal vs. Union of India, but concepts of offensive/menacing messages persist in other frameworks.",
                keywords: ["offensive message", "menacing character"]
            },
            "67": {
                id: "67",
                description: "Punishment for publishing or transmitting obscene material in electronic form.",
                keywords: ["obscene material", "lascivious content", "prurient interest"]
            },
            "67A": {
                id: "67A",
                description: "Punishment for publishing or transmitting of material containing sexually explicit act, etc. in electronic form.",
                keywords: ["sexually explicit act", "child pornography", "publishing pornography"]
            },
            "69A": {
                id: "69A",
                description: "Power to issue directions for blocking for public access of any information through any computer resource (sovereignty, integrity, defence, security of state).",
                keywords: ["threat to sovereignty", "threat to state security", "defense violation"]
            }
        }
    }
};
