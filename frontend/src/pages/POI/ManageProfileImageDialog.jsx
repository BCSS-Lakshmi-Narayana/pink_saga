import React, { useState } from 'react';
import { Camera, User, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import api from '../../lib/api';

const ManageProfileImageDialog = ({ open, onClose, poiData, onUpdate }) => {
    const [activeTab, setActiveTab] = useState('social');
    const [uploading, setUploading] = useState(false);
    const [selectedImage, setSelectedImage] = useState(poiData.profileImage);
    const fileInputRef = React.useRef(null);

    const socialImages = poiData.socialMedia?.filter(s => s.profileImage).map(s => ({
        url: s.profileImage,
        platform: s.platform,
        handle: s.handle
    })) || [];

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            toast.error("File size must be less than 5MB");
            return;
        }

        const formData = new FormData();
        formData.append('files', file);

        try {
            setUploading(true);
            const res = await api.post('/uploads/s3', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (res.data.uploads && res.data.uploads.length > 0) {
                const uploadedUrl = res.data.uploads[0].url;
                setSelectedImage(uploadedUrl);
                setActiveTab('upload'); // Stay on upload tab to show selected
                toast.success("Image uploaded successfully");
            }
        } catch (error) {
            console.error("Upload failed", error);
            toast.error("Failed to upload image");
        } finally {
            setUploading(false);
        }
    };

    const handleSave = () => {
        onUpdate(selectedImage);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md custom-scrollbar">
                <DialogHeader>
                    <DialogTitle>Manage Profile Image</DialogTitle>
                    <DialogDescription>
                        Select an image from linked accounts or upload a new one.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex gap-2 mb-4 border-b border-gray-100">
                    <button
                        onClick={() => setActiveTab('social')}
                        className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'social' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        Linked Accounts
                    </button>
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'upload' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        Upload Photo
                    </button>
                </div>

                <div className="space-y-4 py-2">
                    {/* Preview Selected */}
                    <div className="flex justify-center mb-4">
                        <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-gray-100 shadow-sm relative">
                            {selectedImage ? (
                                <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400">
                                    <User className="w-10 h-10" />
                                </div>
                            )}
                        </div>
                    </div>

                    {activeTab === 'social' && (
                        <div className="grid grid-cols-4 gap-2">
                            {socialImages.length > 0 ? (
                                socialImages.map((img, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => setSelectedImage(img.url)}
                                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${selectedImage === img.url ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-100 hover:border-gray-300'}`}
                                    >
                                        <img src={img.url} alt={img.platform} className="w-full h-full object-cover" />
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-[10px] text-white text-center py-0.5 capitalize truncate px-1">
                                            {img.platform}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="col-span-4 text-center text-sm text-gray-500 py-4 italic">
                                    No profile images found from linked accounts.
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'upload' && (
                        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center text-center hover:bg-gray-50/50 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleFileUpload}
                            />
                            {uploading ? (
                                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
                            ) : (
                                <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-2">
                                    <Camera className="w-5 h-5" />
                                </div>
                            )}
                            <p className="text-sm font-medium text-gray-700">Click to upload image</p>
                            <p className="text-xs text-gray-400 mt-1">SVG, PNG, JPG or GIF (max. 5MB)</p>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 mt-2">
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} disabled={uploading}>Save Changes</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ManageProfileImageDialog;
