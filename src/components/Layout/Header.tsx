'use client';

import { useState } from 'react';
import { Bell, Search, Settings, User, LogOut } from 'lucide-react';

interface HeaderProps {
  className?: string;
}

export function Header({ className = '' }: HeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const notifications = [
    {
      id: 1,
      title: 'Scraping completed',
      message: 'Found 150 new leads for Tech Campaign',
      time: '2 minutes ago',
      type: 'success'
    },
    {
      id: 2,
      title: 'New reply received',
      message: 'John from Acme Corp replied to your email',
      time: '5 minutes ago',
      type: 'info'
    },
    {
      id: 3,
      title: 'Email sent',
      message: '15 emails sent successfully',
      time: '10 minutes ago',
      type: 'success'
    }
  ];

  return (
    <header className={`bg-white border-b border-gray-200 ${className}`}>
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Search */}
          <div className="flex-1 max-w-lg">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search campaigns, leads..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center space-x-4">
            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 text-gray-400 hover:text-gray-600 relative"
              >
                <Bell className="h-6 w-6" />
                <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                  <div className="p-4 border-b border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {notifications.map((notification) => (
                      <div key={notification.id} className="p-4 border-b border-gray-100 hover:bg-gray-50">
                        <div className="flex items-start space-x-3">
                          <div className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${
                            notification.type === 'success' ? 'bg-green-500' :
                            notification.type === 'info' ? 'bg-blue-500' :
                            'bg-yellow-500'
                          }`} />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {notification.title}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-2">
                              {notification.time}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 border-t border-gray-200">
                    <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                      View all notifications
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Settings */}
            <button className="p-2 text-gray-400 hover:text-gray-600">
              <Settings className="h-6 w-6" />
            </button>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-50"
              >
                <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-gray-600" />
                </div>
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                  <div className="p-4 border-b border-gray-200">
                    <p className="text-sm font-medium text-gray-900">Demo User</p>
                    <p className="text-xs text-gray-500">demo@example.com</p>
                  </div>
                  <div className="py-2">
                    <button className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <User className="mr-3 h-4 w-4" />
                      Profile
                    </button>
                    <button className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <Settings className="mr-3 h-4 w-4" />
                      Settings
                    </button>
                    <hr className="my-2" />
                    <button className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <LogOut className="mr-3 h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
