import React, { useEffect } from 'react';
import type { User } from 'firebase/auth';
import { X } from 'lucide-react';
import type { DriveBackupPayload } from '../services/googleDriveBackup';
import { CompanyDataset, CompanyProfile, CrmEmpresaTemplate } from '../types/accounting';
import { GoogleDriveBackupPanel } from './GoogleDriveBackupPanel';

interface DriveBackupModalProps {
  open: boolean;
  onClose: () => void;
  googleUser: User | null;
  crmProfile: CrmEmpresaTemplate | null;
  companies: CompanyProfile[];
  companyData: Record<string, CompanyDataset>;
  activeCompanyId: string;
  isOnline: boolean;
  driveConnected: boolean;
  onGoogleSignIn: () => Promise<void>;
  onSwitchGoogleAccount: (loginHint?: string) => Promise<void>;
  onConnectGoogleDrive: () => Promise<string | null>;
  onDriveTokenExpired: () => void;
  onRestoreBackup: (payload: DriveBackupPayload) => Promise<void>;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const DriveBackupModal: React.FC<DriveBackupModalProps> = ({
  open,
  onClose,
  googleUser,
  crmProfile,
  companies,
  companyData,
  activeCompanyId,
  isOnline,
  driveConnected,
  onGoogleSignIn,
  onSwitchGoogleAccount,
  onConnectGoogleDrive,
  onDriveTokenExpired,
  onRestoreBackup,
  onNotify,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[980] flex items-center justify-center overflow-y-auto bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Copias de Seguridad en Google Drive por Correo del Cliente"
    >
      <div className="relative my-auto w-full max-w-4xl rounded-xl border border-[#c5a059] bg-[#0a0f1d] p-4 shadow-2xl sm:p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#2a3b5c] bg-[#141e33] px-2.5 py-1.5 text-xs font-semibold text-[#94a3b8] transition-colors hover:border-[#c5a059] hover:text-[#f1f5f9]"
          aria-label="Cerrar ventana de copias de seguridad"
        >
          <X className="h-4 w-4" />
          Cerrar
        </button>

        <div className="pt-2">
          <GoogleDriveBackupPanel
            googleUser={googleUser}
            crmProfile={crmProfile}
            companies={companies}
            companyData={companyData}
            activeCompanyId={activeCompanyId}
            isOnline={isOnline}
            driveConnected={driveConnected}
            onGoogleSignIn={onGoogleSignIn}
            onSwitchGoogleAccount={onSwitchGoogleAccount}
            onConnectGoogleDrive={onConnectGoogleDrive}
            onDriveTokenExpired={onDriveTokenExpired}
            onRestoreBackup={onRestoreBackup}
            onNotify={onNotify}
            compact
          />
        </div>
      </div>
    </div>
  );
};
