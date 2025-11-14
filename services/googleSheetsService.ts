
import { GoogleAuthProvider, signInWithPopup, OAuthCredential } from 'firebase/auth';
import { auth, setUserProfile } from './firebase';
import { UserProfile, InventoryItem } from '../types';

const SHEETS_API_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Initiates the Google OAuth flow to get an access token with Sheets API permissions.
 * It re-authenticates the user if necessary to grant the required scope.
 * @returns A promise that resolves to the OAuth access token.
 */
async function getSheetsApiToken(): Promise<string> {
    const provider = new GoogleAuthProvider();
    provider.addScope(SHEETS_API_SCOPE);
    
    // Use the currently signed-in user to link the new credential
    const user = auth.currentUser;
    if (!user) {
        throw new Error("User not signed in.");
    }

    try {
        const result = await signInWithPopup(user.providerData[0] ? auth : user, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (!credential?.accessToken) {
            throw new Error("Could not retrieve access token from Google.");
        }
        return credential.accessToken;
    } catch (error) {
        console.error("Google Sheets Auth Error:", error);
        throw error; // Re-throw to be caught by the calling function
    }
}

/**
 * Creates a new Google Sheet for the user.
 * @param token The OAuth access token.
 * @param title The title for the new spreadsheet.
 * @returns The newly created spreadsheet object from the API.
 */
async function createSheet(token: string, title: string): Promise<any> {
    const response = await fetch(SHEETS_API_BASE_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            properties: { title }
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to create Google Sheet: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Updates a Google Sheet with the provided data.
 * @param token The OAuth access token.
 * @param spreadsheetId The ID of the spreadsheet to update.
 * @param data The 2D array of data to write.
 */
async function updateSheetData(token: string, spreadsheetId: string, data: (string | number)[][]): Promise<void> {
    const range = `Sheet1!A1`; // Start from the top-left cell
    const url = `${SHEETS_API_BASE_URL}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
    
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            values: data
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to update Google Sheet: ${response.statusText}`);
    }
}


/**
 * The main function to handle exporting inventory data to a Google Sheet.
 * @param userProfile The profile of the user initiating the export.
 * @param inventory The inventory data to export.
 * @returns The URL of the created/updated Google Sheet.
 */
export const exportInventoryToSheet = async (userProfile: UserProfile, inventory: InventoryItem[]): Promise<string | null> => {
    const token = await getSheetsApiToken();
    let spreadsheetId = userProfile.spreadsheetId;
    let spreadsheetUrl = '';

    if (!spreadsheetId) {
        const sheetTitle = `Stock Pilot Inventory - ${userProfile.name}`;
        const newSheet = await createSheet(token, sheetTitle);
        spreadsheetId = newSheet.spreadsheetId;
        spreadsheetUrl = newSheet.spreadsheetUrl;
        // Save the new sheet ID to the user's profile for future use
        await setUserProfile(userProfile.uid, { spreadsheetId });
    } else {
        spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    }

    // Prepare data for the sheet
    const headers = ['Item Name', 'Quantity', 'Price/Item (INR)', 'Total Value (INR)', 'Expiry Date', 'Expiry Status'];
    const dataRows = inventory.map(item => [
        item.name.charAt(0).toUpperCase() + item.name.slice(1),
        item.quantity,
        item.price,
        item.quantity * item.price,
        item.expiryDate || 'N/A',
        item.expiryStatus.charAt(0).toUpperCase() + item.expiryStatus.slice(1),
    ]);
    
    const fullSheetData = [headers, ...dataRows];
    await updateSheetData(token, spreadsheetId, fullSheetData);

    return spreadsheetUrl;
};
