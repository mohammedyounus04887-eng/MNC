import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface QRScannerProps {
  onScan: (result: string) => void;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  hint?: string; // legacy alias
}

const QRScanner = ({
  onScan,
  onClose,
  title = 'Scan QR Code',
  subtitle,
  hint,
}: QRScannerProps) => {
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const displaySubtitle = subtitle ?? hint ?? 'Point camera at QR code';

  useEffect(() => {
    setError('');
    setScanning(false);
    const scanner = new Html5Qrcode('qr-scanner-container');
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          scanner.stop().catch(() => {});
          onScan(decodedText);
        },
        () => {},
      )
      .then(() => setScanning(true))
      .catch((err: any) => {
        setError(
          err?.toString?.().includes('NotAllowed') || err?.message?.includes('Permission')
            ? 'Camera permission denied. Allow camera access in browser settings.'
            : 'Could not start camera. Please try again.',
        );
      });

    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
  }, [retryKey]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.95)',
        zIndex: 999999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: 'none',
            color: 'white',
            width: 40,
            height: 40,
            borderRadius: '50%',
            fontSize: 20,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              color: 'white',
              fontSize: 18,
              fontWeight: 800,
              fontFamily: 'Nunito, sans-serif',
            }}
          >
            {title}
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.6)',
              fontSize: 13,
              marginTop: 2,
            }}
          >
            {displaySubtitle}
          </div>
        </div>
        <div style={{ width: 40 }} />
      </div>

      {/* Scanner or Error */}
      {error ? (
        <div
          style={{
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: 32,
            maxWidth: 300,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
          <div
            style={{
              color: 'white',
              fontSize: 15,
              lineHeight: 1.5,
              marginBottom: 20,
            }}
          >
            {error}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => setRetryKey((k) => k + 1)}
              style={{
                background: '#2d9653',
                color: 'white',
                border: 'none',
                borderRadius: 10,
                padding: '12px 24px',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'Nunito, sans-serif',
              }}
            >
              🔄 Retry
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.15)',
                color: 'white',
                border: '2px solid rgba(255,255,255,0.3)',
                borderRadius: 10,
                padding: '12px 24px',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'Nunito, sans-serif',
              }}
            >
              Go Back
            </button>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div
            id="qr-scanner-container"
            style={{
              width: 300,
              height: 300,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          />
          {scanning && (
            <>
              {[
                {
                  top: 0,
                  left: 0,
                  borderTop: '4px solid #2d9653',
                  borderLeft: '4px solid #2d9653',
                  borderRadius: '12px 0 0 0',
                },
                {
                  top: 0,
                  right: 0,
                  borderTop: '4px solid #2d9653',
                  borderRight: '4px solid #2d9653',
                  borderRadius: '0 12px 0 0',
                },
                {
                  bottom: 0,
                  left: 0,
                  borderBottom: '4px solid #2d9653',
                  borderLeft: '4px solid #2d9653',
                  borderRadius: '0 0 0 12px',
                },
                {
                  bottom: 0,
                  right: 0,
                  borderBottom: '4px solid #2d9653',
                  borderRight: '4px solid #2d9653',
                  borderRadius: '0 0 12px 0',
                },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    width: 40,
                    height: 40,
                    pointerEvents: 'none',
                    ...s,
                  }}
                />
              ))}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  height: 3,
                  background:
                    'linear-gradient(90deg, transparent, #2d9653, transparent)',
                  animation: 'scanLine 2s linear infinite',
                  pointerEvents: 'none',
                }}
              />
            </>
          )}
        </div>
      )}

      {scanning && !error && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            color: 'rgba(255,255,255,0.7)',
            fontSize: 14,
            textAlign: 'center',
            padding: '0 40px',
          }}
        >
          Align QR code within the frame
        </div>
      )}

      <style>{`
        @keyframes scanLine {
          0%   { top: 10%; }
          50%  { top: 85%; }
          100% { top: 10%; }
        }
      `}</style>
    </div>
  );
};

export default QRScanner;
