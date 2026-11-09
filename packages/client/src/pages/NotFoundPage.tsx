import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export const NotFoundPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-[#1B4F72] mb-2">404</h1>
        <p className="text-lg text-gray-600 mb-6">
          {t('notFound.message')}
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 rounded-lg bg-[#1B4F72] text-white font-medium hover:bg-[#164060] transition-colors focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:ring-offset-2"
        >
          {t('notFound.goHome')}
        </Link>
      </div>
    </div>
  );
};

export default NotFoundPage;
