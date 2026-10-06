import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card } from '../components/ui/card';
import { toast } from 'sonner';

const Analytics = () => {
  const [overview, setOverview] = useState(null);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const [overviewRes, trendsRes] = await Promise.all([
        api.get('/analytics/overview'),
        api.get('/analytics/trends?days=7')
      ]);
      setOverview(overviewRes.data);
      setTrends(trendsRes.data);
    } catch (error) {
      toast.error('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };



  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  }

  return (
    <div className="space-y-6" data-testid="analytics-page">
      <div>
        <h1 className="text-3xl font-heading font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground mt-1">Insights and trends from monitored content</p>
      </div>

      {/* Risk Distribution */}
      {overview?.risk_distribution && (
        <Card className="p-6">
          <h2 className="text-xl font-heading font-semibold mb-6">Risk Distribution</h2>
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Donut Chart */}
            <div className="relative h-[250px] w-[250px] flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={overview.risk_distribution.map(item => ({ name: item._id, value: item.count }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {overview.risk_distribution.map((entry, index) => {
                      const colorMap = {
                        'HIGH': '#ef4444',
                        'MEDIUM': '#f59e0b',
                        'LOW': '#10b981'
                      };
                      return <Cell key={`cell-${index}`} fill={colorMap[entry.name] || '#94a3b8'} strokeWidth={0} />;
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Center Text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold">
                  {overview.risk_distribution.reduce((acc, curr) => acc + curr.count, 0)}
                </span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Total</span>
              </div>
            </div>

            {/* Custom Legend */}
            <div className="flex-1 w-full grid gap-4">
              {overview.risk_distribution.map((item) => {
                const total = overview.risk_distribution.reduce((acc, curr) => acc + curr.count, 0);
                const percent = ((item.count / total) * 100).toFixed(1);
                const colorMap = {
                  'HIGH': 'bg-red-500',
                  'MEDIUM': 'bg-amber-500',
                  'LOW': 'bg-emerald-500'
                };
                const colorClass = colorMap[item._id] || 'bg-slate-400';

                return (
                  <div key={item._id} className="flex items-center justify-between p-3 rounded-lg border bg-card/50">
                    <div className="flex items-center gap-3">
                      <div className={`h-3 w-3 rounded-full ${colorClass}`} />
                      <span className="font-medium text-sm">
                        {item._id === 'HIGH' ? 'High Risk' :
                          item._id === 'MEDIUM' ? 'Medium Risk' :
                            item._id === 'LOW' ? 'Low Risk' : item._id}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-bold">{item.count}</span>
                      <span className="text-xs text-muted-foreground w-12 text-right">{percent}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Content Trend */}
      {trends?.content_trend && trends.content_trend.length > 0 && (
        <Card className="p-6">
          <h2 className="text-xl font-heading font-semibold mb-4">Content Monitoring Trend (Last 7 Days)</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends.content_trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="_id" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="count" stroke="#3b82f6" name="Content Items" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Sources</h3>
          <p className="text-3xl font-bold">{overview?.total_sources || 0}</p>
          <p className="text-sm text-green-600 mt-1">{overview?.active_sources || 0} active</p>
        </Card>
        <Card className="p-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Content</h3>
          <p className="text-3xl font-bold">{overview?.total_content || 0}</p>
          <p className="text-sm text-muted-foreground mt-1">Monitored items</p>
        </Card>
        <Card className="p-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Active Alerts</h3>
          <p className="text-3xl font-bold">{overview?.active_alerts || 0}</p>
          <p className="text-sm text-muted-foreground mt-1">Require attention</p>
        </Card>
      </div>
    </div>
  );
};

export default Analytics;
