import { Tabs } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { TabBarButtonFix } from '../../src/components/TabBarButtonFix'

const TAB_BAR_BG = '#161616'
const ACTIVE = '#22c55e'
const INACTIVE = '#555'

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: TAB_BAR_BG,
          borderTopColor: '#222',
          height: 64,
          paddingBottom: 10,
        },
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        // Split-screen touch bug workaround (see src/components/TabBarButtonFix.tsx)
        tabBarButton: (props) => <TabBarButtonFix {...props} />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: 'Journal',
          tabBarIcon: ({ color }) => <Feather name="book-open" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ color }) => <Feather name="bar-chart-2" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="strategy"
        options={{
          title: 'Strategie',
          tabBarIcon: ({ color }) => <Feather name="trending-up" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Einstellungen',
          tabBarIcon: ({ color }) => <Feather name="settings" size={22} color={color} />,
        }}
      />
    </Tabs>
  )
}
